import SwiftUI
import UIKit

struct OrderDetailView: View {
    @State private var order: Order
    var store: OrdersStore
    @State private var threadRevision = 0

    init(order: Order, store: OrdersStore) {
        _order = State(initialValue: order)
        self.store = store
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.padLarge) {
                    detailCard
                    aftercareHistory
                    AftercareChatView(order: order, store: store) {
                        threadRevision += 1
                    }
                    .id("chat")
                }
                .padding(Theme.pad)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.orders) { _, _ in
                if let next = store.order(id: order.id) {
                    order = next
                }
            }
            .onChange(of: threadRevision) { _, _ in
                withAnimation(Motion.spring) {
                    proxy.scrollTo("chat-end", anchor: .bottom)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                withAnimation(Motion.spring) {
                    proxy.scrollTo("chat-end", anchor: .bottom)
                }
            }
        }
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("Order")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.canvas, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
    }

    private var window: ReturnWindow { order.returnWindow() }

    private var detailCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(order.title)
                .font(.ui(20, weight: .semibold))
                .foregroundStyle(Color.canvas)
            detailRow(label: "Merchant", value: order.merchant)
            HStack {
                Text("Price")
                    .font(.ui(13))
                    .foregroundStyle(Color.canvas.opacity(0.55))
                Spacer()
                Text(formatGBP(order.pricePence))
                    .font(.money(16))
                    .foregroundStyle(Color.accent)
            }
            detailRow(label: "Sold as", value: order.sectionLabel)
            HStack(alignment: .firstTextBaseline) {
                Text("Order id")
                    .font(.ui(13))
                    .foregroundStyle(Color.canvas.opacity(0.55))
                Spacer()
                Text(order.id)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.canvas)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityIdentifier("order.id")
                    .accessibilityValue(order.id)
                Button {
                    UIPasteboard.general.string = order.id
                    Haptics.light()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy order id")
            }
            HStack(alignment: .top, spacing: 10) {
                ReturnWindowRing(window: window)
                VStack(alignment: .leading, spacing: 2) {
                    Text(window.headline)
                        .font(.ui(14, weight: .medium))
                        .foregroundStyle(Color.canvas)
                    Text(window.footnote)
                        .font(.ui(11))
                        .foregroundStyle(Color.canvas.opacity(0.5))
                }
            }
            Text("Tracking isn't connected yet")
                .font(.ui(13))
                .foregroundStyle(Color.canvas.opacity(0.5))
        }
        .padding(Theme.pad)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.black)
        )
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.ui(13))
                .foregroundStyle(Color.canvas.opacity(0.55))
            Spacer()
            Text(value)
                .font(.ui(14, weight: .medium))
                .foregroundStyle(Color.canvas)
                .multilineTextAlignment(.trailing)
        }
    }

    @ViewBuilder
    private var aftercareHistory: some View {
        if let entries = order.aftercare, !entries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Earlier requests")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(AftercarePresentation.remedyLabel(entry.remedy))
                                .font(.ui(14, weight: .semibold))
                                .foregroundStyle(Color.canvas)
                            Text(entry.note)
                                .font(.ui(13))
                                .foregroundStyle(Color.canvas.opacity(0.7))
                            if entry.refused {
                                Text("Refused")
                                    .font(.ui(11, weight: .medium))
                                    .foregroundStyle(Color.dangerGrey)
                            }
                            Text(OrderDate.listLabel(entry.t))
                                .font(.ui(11))
                                .foregroundStyle(Color.canvas.opacity(0.45))
                                .monospacedDigit()
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(Theme.pad)
                    .background(
                        RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                            .fill(Color.black)
                    )
                }
            }
        }
    }
}

struct AftercareChatView: View {
    let order: Order
    var store: OrdersStore
    var onThreadChange: () -> Void = {}

    @State private var turns: [AftercareTurn] = []
    @State private var draft = ""
    @State private var sending = false
    @FocusState private var composerFocused: Bool

    private let chips = ["Return it", "It's faulty", "Replacement", "Repair"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Returns and repairs")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                Text("I draft the letter. You send it. Covered has not emailed the seller.")
                    .font(.ui(12))
                    .foregroundStyle(Color.muted)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.self) { chip in
                        Button(chip) { send(chip) }
                            .font(.ui(13, weight: .medium))
                            .foregroundStyle(sending ? Color.muted : Color.ink)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(Color.black.opacity(0.06))
                            )
                    }
                }
            }
            .disabled(sending)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(turns) { turn in
                    chatBubble(turn)
                        .id(turn.id)
                        .ordersSwap()
                }
                if sending {
                    Text("Drafting…")
                        .font(.ui(12))
                        .foregroundStyle(Color.muted)
                }
                Color.clear.frame(height: 1).id("chat-end")
            }

            composer
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Return it, or say what is wrong", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.ui(15))
                .foregroundStyle(Color.ink)
                .lineLimit(1...5)
                .focused($composerFocused)
                .accessibilityIdentifier("aftercare.composer")
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                        .fill(Color.white.opacity(0.7))
                )
            Button {
                send(draft)
            } label: {
                Text("Send")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(Color.black)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        Capsule(style: .continuous)
                            .fill(Color.accent)
                    )
            }
            .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
            .accessibilityIdentifier("aftercare.send")
        }
    }

    private func chatBubble(_ turn: AftercareTurn) -> some View {
        HStack {
            if turn.role == .user { Spacer(minLength: 36) }
            VStack(alignment: turn.role == .user ? .trailing : .leading, spacing: 8) {
                Text(turn.text)
                    .font(.ui(15))
                    .foregroundStyle(turn.role == .user ? Color.ink : Color.canvas)
                    .frame(maxWidth: .infinity, alignment: turn.role == .user ? .trailing : .leading)
                    .accessibilityIdentifier(turn.role == .assistant ? "aftercare.reply" : "aftercare.user")
                if let outcome = turn.outcome {
                    Text(outcome)
                        .font(.ui(12, weight: .medium))
                        .foregroundStyle(turn.refused ? Color.canvas.opacity(0.65) : Color.accent)
                }
                if turn.refused {
                    Text("Covered won't claim a fault that isn't there.")
                        .font(.ui(12))
                        .foregroundStyle(Color.canvas.opacity(0.55))
                }
                if let draftText = turn.draftToSeller, !draftText.isEmpty {
                    DraftToSellerCard(text: draftText)
                        .accessibilityIdentifier("aftercare.draft")
                }
            }
            .padding(Theme.pad)
            .background(
                RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
                    .fill(turn.role == .user ? Color.white.opacity(0.7) : Color.black)
            )
            if turn.role == .assistant { Spacer(minLength: 36) }
        }
    }

    private func send(_ raw: String) {
        let message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !sending else { return }
        draft = ""
        let userTurn = AftercareTurn(
            id: UUID().uuidString,
            role: .user,
            text: message,
            outcome: nil,
            draftToSeller: nil,
            refused: false
        )
        let history = turns.map(\.historyPayload)
        withAnimation(Motion.spring) {
            turns.append(userTurn)
        }
        onThreadChange()
        sending = true
        Task {
            do {
                let response = try await store.assist(
                    orderId: order.id,
                    message: message,
                    history: history
                )
                let bot = AftercareTurn(
                    id: UUID().uuidString,
                    role: .assistant,
                    text: response.reply,
                    outcome: AftercarePresentation.outcomeLine(response),
                    draftToSeller: response.draftToSeller,
                    refused: response.refused
                )
                withAnimation(Motion.spring) {
                    turns.append(bot)
                }
                composerFocused = false
                onThreadChange()
                await store.refresh()
            } catch {
                let failed = AftercareTurn(
                    id: UUID().uuidString,
                    role: .assistant,
                    text: (error as? APIError)?.errorDescription ?? "The aftercare service is unreachable. Try again in a moment.",
                    outcome: nil,
                    draftToSeller: nil,
                    refused: false
                )
                withAnimation(Motion.spring) {
                    turns.append(failed)
                }
                onThreadChange()
            }
            sending = false
        }
    }
}

private struct DraftToSellerCard: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Copy to the seller")
                .font(.ui(11, weight: .semibold))
                .foregroundStyle(Color.canvas.opacity(0.55))
            Text(text)
                .font(.ui(13))
                .foregroundStyle(Color.canvas)
                .textSelection(.enabled)
            Text("Covered has not sent this letter.")
                .font(.ui(12, weight: .medium))
                .foregroundStyle(Color.canvas.opacity(0.6))
            HStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = text
                    Haptics.light()
                } label: {
                    Text("Copy")
                        .font(.ui(13, weight: .semibold))
                        .foregroundStyle(Color.black)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(Color.accent))
                }
                .buttonStyle(.plain)
                ShareLink(item: text) {
                    Text("Share")
                        .font(.ui(13, weight: .semibold))
                        .foregroundStyle(Color.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(
                            Capsule().strokeBorder(Color.accent, lineWidth: 1)
                        )
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
    }
}
