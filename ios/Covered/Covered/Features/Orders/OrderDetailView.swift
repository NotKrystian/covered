import SwiftUI
import UIKit

struct OrderDetailView: View {
    @State private var order: Order
    var store: OrdersStore
    @State private var threadRevision = 0
    @State private var checking = false
    @State private var simulating = false
    @State private var accepting = false
    @State private var switchError: String?
    @State private var accepted: SwitchAcceptResponse?

    init(order: Order, store: OrdersStore) {
        _order = State(initialValue: order)
        self.store = store
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    detailCard
                    switchSection
                    aftercareHistory
                    AftercareChatView(order: order, store: store) {
                        threadRevision += 1
                    }
                    .id("chat")
                }
                .padding(.horizontal, Theme.inset)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.orders) { _, _ in
                if let next = store.order(id: order.id) {
                    order = next
                }
            }
            .onChange(of: threadRevision) { _, _ in
                withAnimation(Motion.soft) {
                    proxy.scrollTo("chat-end", anchor: .bottom)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                withAnimation(Motion.soft) {
                    proxy.scrollTo("chat-end", anchor: .bottom)
                }
            }
        }
        .background(Color.screen.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.screen, for: .navigationBar)
    }

    private var watch: SwitchWatch? { store.watch(for: order) }
    private var window: ReturnWindow { order.returnWindow(watch: watch) }

    private var detailCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: Theme.radiusPhotoDetail, style: .continuous)
                    .fill(Color.photoHole)
                    .frame(width: 91.5, height: 91.5)
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.title)
                        .font(.system(size: 18.5, weight: .semibold))
                        .tracking(-0.4)
                        .foregroundStyle(Color.inkSoft)
                    Text("\(order.shortId) · \(formatGBP(order.pricePence))")
                        .filmMoney(16.5, weight: .semibold, tracking: -0.2)
                        .foregroundStyle(Color.inkSoft)
                    Text(order.merchant)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                    Text(order.id)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.tertiary)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityIdentifier("order.id")
                        .accessibilityValue(order.id)
                }
            }

            ReturnWindowRing(window: window, compact: false)
                .frame(maxWidth: .infinity)

            Text(window.headline)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)

            Text("Tracking isn't connected yet")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
        }
        .padding(18)
        .background(Color.panel, in: RoundedRectangle(cornerRadius: 27.5, style: .continuous))
    }

    @ViewBuilder
    private var switchSection: some View {
        if store.switchAuthBlocked {
            Text("Price-drop switch needs a paired session. The switch routes may still be cookie-only.")
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
        } else if let blocked = watch?.blocked, !blocked.isEmpty {
            Text(blocked)
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
        } else if order.cancelledAt != nil {
            OrderRow(order: order, watch: watch, compact: true)
            if let accepted {
                Text("New order · \(accepted.newOrderId ?? "")")
                    .font(.system(size: 14.5))
                    .foregroundStyle(Color.secondary)
            }
        } else if window.isOpen {
            if let offer = (order.switchCheck?.offer ?? watch?.order.switchCheck?.offer) {
                PriceDropAlert(offer: offer)
                SwitchSumCard(order: order, offer: offer)
                InkPillButton(title: accepting ? "Switching…" : "Switch", identifier: "order.switch") {
                    Task { await accept() }
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    InkPillButton(title: checking ? "Checking…" : "Check now", identifier: "order.switchCheck") {
                        Task { await checkNow() }
                    }
                    Button("Simulate a price drop (demo)") {
                        Task { await simulate() }
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.secondary)
                    .accessibilityIdentifier("order.simulateSwitch")
                    .disabled(simulating)
                }
            }
            if let switchError {
                Text(switchError)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
            }
        }
    }

    @ViewBuilder
    private var aftercareHistory: some View {
        if let entries = order.aftercare, !entries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Earlier requests")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.secondary)
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(AftercarePresentation.remedyLabel(entry.remedy))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.inkSoft)
                        Text(entry.note)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.secondary)
                    }
                    .padding(14.5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                            .strokeBorder(Color.hairline, lineWidth: 1)
                    )
                }
            }
        }
    }

    private func checkNow() async {
        checking = true
        switchError = nil
        defer { checking = false }
        do {
            let result = try await store.checkSwitch(order: order)
            if let next = result.order { order = next }
            await store.refresh()
            if result.found != true {
                switchError = nextNote(result) ?? "No cheaper UK shop cleared your floor."
            }
        } catch let error as APIError {
            switchError = error.errorDescription
        } catch {
            switchError = error.localizedDescription
        }
    }

    private func simulate() async {
        simulating = true
        switchError = nil
        defer { simulating = false }
        do {
            let result = try await store.simulateSwitch(orderId: order.id)
            if let next = result.order { order = next }
            await store.refresh()
            if result.found != true {
                switchError = nextNote(result) ?? "Simulation did not clear a switch."
            }
        } catch let error as APIError {
            switchError = error.errorDescription
        } catch {
            switchError = error.localizedDescription
        }
    }

    private func accept() async {
        accepting = true
        switchError = nil
        defer { accepting = false }
        do {
            let ok = try await confirmWithFaceID()
            guard ok else {
                switchError = "Could not confirm it was you."
                return
            }
            let result = try await store.acceptSwitch(orderId: order.id)
            accepted = result
            Haptics.success()
            await store.refresh()
            if let next = store.order(id: order.id) { order = next }
        } catch let error as APIError {
            switchError = error.errorDescription
        } catch {
            switchError = error.localizedDescription
        }
    }

    private func nextNote(_ result: SwitchRunResponse) -> String? {
        result.order?.switchCheck?.note
    }
}

private struct PriceDropAlert: View {
    let offer: SwitchOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.accent).frame(width: 6.5, height: 6.5)
                        Text(offer.simulated ? "Demo price drop" : "Clear-out sale")
                            .font(.system(size: 17.5, weight: .semibold))
                            .tracking(-0.35)
                            .foregroundStyle(Color.white)
                    }
                    Text("same item \(formatGBP(offer.pricePence))\nat another UK shop")
                        .font(.system(size: 15.5))
                        .foregroundStyle(Color.alertBody)
                    Text("\(offer.merchant) · UK shop")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.alertMeta)
                }
                Spacer()
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Color.memChip)
                    .frame(width: 64, height: 64)
            }
            HStack(spacing: 6) {
                memoryChip("same item")
                memoryChip(formatGBP(offer.pricePence))
                memoryChip("UK shop")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.ink, in: RoundedRectangle(cornerRadius: Theme.radiusAlert, style: .continuous))
    }

    private func memoryChip(_ text: String) -> some View {
        HStack(spacing: 5) {
            ChipMiniCheck()
            Text(text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white)
        }
        .padding(.horizontal, 10)
        .frame(height: 31)
        .background(Color.memChip, in: Capsule())
    }
}

private struct ChipMiniCheck: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 1.5, y: 6))
            path.addLine(to: CGPoint(x: 4.2, y: 8.8))
            path.addLine(to: CGPoint(x: 10, y: 2.2))
        }
        .stroke(Color.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        .frame(width: 12, height: 12)
    }
}

private struct SwitchSumCard: View {
    let order: Order
    let offer: SwitchOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            sumRow("Paid", formatGBP(order.pricePence))
            sumRow("New price", formatGBP(offer.pricePence))
            sumRow("Return postage", formatGBP(offer.postagePence))
            Rectangle()
                .fill(Color.ink)
                .frame(height: 1.5)
            HStack {
                Text("= \(formatGBP(offer.clearPence))")
                    .filmMoney(31, weight: .bold, tracking: -0.8)
                    .foregroundStyle(Color.inkSoft)
                Spacer()
                Text("clears your \(formatGBP(offer.clearPence))")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.accent, in: Capsule())
            }
        }
        .padding(18)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radiusAlert, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusAlert, style: .continuous)
                .strokeBorder(Color.track, lineWidth: 1.5)
        )
    }

    private func sumRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
            Spacer()
            Text(value)
                .filmMoney(21, weight: .semibold, tracking: -0.2)
                .foregroundStyle(Color.inkSoft)
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

    private let chips = ["Return it", "It's faulty"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("I draft the letter. You send it. Covered has not emailed the seller.")
                .font(.system(size: 13))
                .foregroundStyle(Color.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.self) { chip in
                        Button(chip) { send(chip) }
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.chipText)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color.chipNeutral, in: Capsule())
                    }
                }
            }
            .disabled(sending)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(turns) { turn in
                    chatBubble(turn)
                        .id(turn.id)
                        .coveredSwap()
                }
                if sending {
                    TypingDots()
                }
                Color.clear.frame(height: 1).id("chat-end")
            }

            ComposerBar(
                text: $draft,
                placeholder: "Return it, or say what is wrong",
                identifier: "aftercare.composer",
                sendIdentifier: "aftercare.send",
                focused: $composerFocused,
                enabled: !sending,
                onSend: { send(draft) }
            )
        }
    }

    private func chatBubble(_ turn: AftercareTurn) -> some View {
        HStack {
            if turn.role == .user { Spacer(minLength: 36) }
            VStack(alignment: turn.role == .user ? .trailing : .leading, spacing: 8) {
                Text(turn.text)
                    .font(.system(size: 17.5, weight: .medium))
                    .foregroundStyle(turn.role == .user ? Color.white : Color.inkSoft)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier(turn.role == .assistant ? "aftercare.reply" : "aftercare.user")
                if let draftText = turn.draftToSeller, !draftText.isEmpty {
                    DraftToSellerCard(text: draftText)
                        .accessibilityIdentifier("aftercare.draft")
                }
            }
            .padding(16)
            .background(
                (turn.role == .user ? Color.ink : Color.composer),
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
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
        withAnimation(Motion.soft) { turns.append(userTurn) }
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
                withAnimation(Motion.soft) { turns.append(bot) }
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
                withAnimation(Motion.soft) { turns.append(failed) }
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
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Color.inkSoft)
                .textSelection(.enabled)
            HStack {
                Button {
                    UIPasteboard.general.string = text
                    Haptics.light()
                } label: {
                    Text("Copy")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.ink, in: Capsule())
                }
                .buttonStyle(.plain)
                ShareLink(item: text) {
                    Text("Share")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.hairline, lineWidth: 1)
        )
    }
}
