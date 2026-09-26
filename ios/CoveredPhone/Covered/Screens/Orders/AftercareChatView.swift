// Returns and repairs. Calls POST /api/orders/assist; the server drafts a letter
// naming the UK right. It never emails the merchant and never spends the wallet.
import SwiftUI

struct AftercareChatView: View {
    let order: OrderRecord

    private struct Turn: Identifiable, Equatable {
        enum Content: Equatable {
            case user(String)
            case assistant(AftercareAssist)
            case error(String)
        }
        let id = UUID()
        let content: Content
    }

    @State private var turns: [Turn] = []
    @State private var message = ""
    @State private var busy = false
    @State private var copied: UUID?
    @FocusState private var focused: Bool

    private let api = CoveredAPI.shared

    private static let starters = [
        "I want to return it, I changed my mind",
        "It arrived faulty, I want a refund",
        "The zip broke, can I get a repair?",
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        intro
                        ForEach(turns) { turn in
                            turnView(turn).id(turn.id)
                        }
                        if busy {
                            HStack(spacing: 8) {
                                ProgressView().tint(Theme.accent).controlSize(.small)
                                Text("Reading the order and your rights…")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.muted)
                            }
                            .id("busy")
                        }
                    }
                    .padding(20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: turns.count) { _, _ in
                    withAnimation(Motion.spring) {
                        proxy.scrollTo(turns.last?.id, anchor: .bottom)
                    }
                }
            }

            composer
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Returns and repairs")
                .headline(22)
            Text("Say what happened. Covered names the right that applies (14-day cooling-off, 30-day right to reject, repair or replacement under the Consumer Rights Act) and drafts the message for you to send. It will not email the seller and will not invent a fault.")
                .font(.system(size: 13))
                .lineSpacing(3)
                .foregroundStyle(Theme.muted)
            if turns.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Self.starters, id: \.self) { starter in
                        Button {
                            message = starter
                            send()
                        } label: {
                            Text(starter)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.foreground)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(Theme.panelRaised).overlay(Capsule().strokeBorder(Theme.line)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private func turnView(_ turn: Turn) -> some View {
        switch turn.content {
        case .user(let text):
            HStack {
                Spacer(minLength: 40)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.background)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.foreground))
            }
        case .assistant(let assist):
            VStack(alignment: .leading, spacing: 10) {
                Text(assist.reply)
                    .font(.system(size: 15))
                    .lineSpacing(3)
                    .foregroundStyle(Theme.foreground)
                HStack(spacing: 8) {
                    Chip(text: assist.refused ? "refused" : assist.remedy.rawValue, accent: !assist.refused && assist.remedy != .none)
                    Text(assist.right)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
                Text(assist.outcomeLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(assist.refused ? Theme.danger : Theme.accent)
                if let draft = assist.draftToSeller, !draft.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Draft to \(order.merchant)")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                            Spacer()
                            Button {
                                UIPasteboard.general.string = draft
                                Haptics.tap()
                                withAnimation(Motion.spring) { copied = turn.id }
                            } label: {
                                Label(copied == turn.id ? "Copied" : "Copy", systemImage: copied == turn.id ? "checkmark" : "doc.on.doc")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.accent)
                            }
                            .buttonStyle(.plain)
                        }
                        Text(draft)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Theme.foreground)
                            .textSelection(.enabled)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panelRaised))
                    Text("Not sent. Copy it and email the seller yourself.")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panelCard()
        case .error(let text):
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(Theme.danger)
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("What happened with this order?", text: $message, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 15))
                .foregroundStyle(Theme.foreground)
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { send() }
            Button { send() } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.background)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Theme.accent))
            }
            .buttonStyle(.plain)
            .disabled(busy || message.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(message.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.panel).overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(focused ? Theme.accent : Theme.line)))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.background)
    }

    private var history: [AftercareTurn] {
        turns.compactMap { turn in
            switch turn.content {
            case .user(let text): return AftercareTurn(role: .user, text: text)
            case .assistant(let assist): return AftercareTurn(role: .assistant, text: assist.reply)
            case .error: return nil
            }
        }
        .suffix(20)
        .map { $0 }
    }

    private func send() {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        let priorHistory = history
        message = ""
        withAnimation(Motion.spring) { turns.append(Turn(content: .user(text))) }
        busy = true
        Task {
            do {
                let assist = try await api.assist(orderId: order.id, message: text, history: priorHistory)
                withAnimation(Motion.spring) { turns.append(Turn(content: .assistant(assist))) }
            } catch {
                let line = (error as? APIError)?.message ?? error.localizedDescription
                withAnimation(Motion.spring) { turns.append(Turn(content: .error(line))) }
            }
            busy = false
        }
    }
}
