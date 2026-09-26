// The pay gesture. The side button cannot be hooked on real hardware, so the
// double-click is two taps within 600 ms (or a long press) on the pay control.
// Approve debits the server wallet and writes the receipt; 402 shows the shortfall.
import SwiftUI

struct ApproveSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    let query: String
    let item: ShortlistItem
    let decision: Decision
    let onPaid: (String) -> Void

    private static let doublePressWindow: TimeInterval = 0.6

    private enum PayState: Equatable {
        case idle
        case armed
        case paying
        case paid(id: String, balance: Int)
        case short(String)
        case failed(String)
    }

    @State private var state: PayState = .idle
    @State private var lastTap: Date = .distantPast

    private var shortBy: Int? {
        guard let price = item.pricePence else { return nil }
        return max(0, price - app.balancePence)
    }

    private var canPay: Bool {
        guard let shortBy, item.pricePence != nil else { return false }
        switch state {
        case .idle, .armed, .failed: return shortBy == 0
        case .paying, .paid, .short: return false
        }
    }

    private var ringPhase: RingCheck.Phase {
        switch state {
        case .idle, .armed: return .idle
        case .paying: return .paying
        case .paid: return .done
        case .short, .failed: return .failed
        }
    }

    private var controlLabel: String {
        switch state {
        case .idle:
            if item.pricePence == nil { return "No price to pay" }
            if let shortBy, shortBy > 0 { return "Not enough in the wallet" }
            return "Double-click to pay"
        case .armed: return "Tap again to confirm"
        case .paying: return "Paying from wallet…"
        case .paid: return "Paid"
        case .short: return "Wallet is short"
        case .failed: return "Try again"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    BrandMark()
                    Chip(text: "demo wallet")
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Theme.panelRaised))
                }
                .buttonStyle(.plain)
                .disabled(state == .paying)
            }

            Text("Covered wallet · \(Money.format(app.balancePence))")
                .font(.system(size: 13))
                .tabular()
                .foregroundStyle(Theme.muted)
                .padding(.top, 18)

            HStack(alignment: .lastTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.merchant)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                    Text(item.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                }
                Spacer()
                Text(item.priceLabel)
                    .font(.system(size: 26, weight: .semibold))
                    .tabular()
                    .foregroundStyle(Theme.foreground)
            }
            .padding(.top, 8)

            Divider().overlay(Theme.line).padding(.vertical, 14)

            VStack(spacing: 8) {
                row("Pay from", "Covered demo wallet")
                row("Balance", balanceLine)
                if !decision.rights.isEmpty {
                    row("Keeps", decision.rights.joined(separator: " · "))
                }
            }

            statusLine
                .padding(.top, 12)

            payControl
                .padding(.top, 16)

            Text(footnote)
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.panel)
        .interactiveDismissDisabled(state == .paying)
        .animation(Motion.spring, value: state)
    }

    private var balanceLine: String {
        if case .paid(_, let balance) = state { return "\(Money.format(balance)) after" }
        if let price = item.pricePence, shortBy == 0 {
            return "\(Money.format(app.balancePence)) → \(Money.format(app.balancePence - price))"
        }
        return Money.format(app.balancePence)
    }

    private var footnote: String {
        switch state {
        case .paid: return "Receipt written. No card was charged."
        default: return "Demo money only. No card is charged. Two taps, or hold."
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.system(size: 13)).foregroundStyle(Theme.muted)
            Spacer(minLength: 16)
            Text(value)
                .font(.system(size: 13))
                .tabular()
                .foregroundStyle(Theme.foreground)
                .multilineTextAlignment(.trailing)
                .lineLimit(3)
        }
    }

    @ViewBuilder
    private var statusLine: some View {
        switch state {
        case .idle, .armed, .paying:
            if let shortBy, shortBy > 0 {
                Text("Short by \(Money.format(shortBy)). Deposit into the wallet, then approve again.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.danger)
            }
        case .paid(let id, _):
            Text("Paid \(item.priceLabel) to \(item.merchant) · receipt \(id.prefix(8))…")
                .font(.system(size: 13))
                .foregroundStyle(Theme.accent)
        case .short(let message):
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.danger)
        case .failed(let message):
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.danger)
        }
    }

    // MARK: Pay control — the one shape that becomes the ring, then the check

    private var payControl: some View {
        ZStack {
            RoundedRectangle(cornerRadius: isRound ? 36 : 14, style: .continuous)
                .fill(canPay || state == .armed ? Theme.accentSoft : Theme.panelRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: isRound ? 36 : 14, style: .continuous)
                        .strokeBorder(canPay || state == .armed ? Theme.accent.opacity(0.5) : Theme.line)
                )
                .frame(maxWidth: isRound ? 72 : .infinity)
                .frame(height: 72)

            if isRound {
                RingCheck(phase: ringPhase, size: 72)
            } else {
                HStack(spacing: 10) {
                    if state == .armed {
                        Circle().fill(Theme.accent).frame(width: 8, height: 8)
                    }
                    Text(controlLabel)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(canPay || state == .armed ? Theme.accent : Theme.muted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { tap() }
        .onLongPressGesture(minimumDuration: 0.6) { hold() }
        .accessibilityLabel(controlLabel)
        .accessibilityHint("Double tap, or press and hold, to pay from the wallet")
        .overlay(alignment: .bottom) {
            if case .paid = state {
                Text("Done")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .offset(y: 26)
                    .onTapGesture { dismiss() }
            }
        }
    }

    private var isRound: Bool {
        switch state {
        case .paying, .paid: return true
        case .idle, .armed, .short, .failed: return false
        }
    }

    private func tap() {
        guard canPay else {
            if case .paid = state { dismiss() }
            return
        }
        let now = Date()
        if state == .armed, now.timeIntervalSince(lastTap) < Self.doublePressWindow {
            lastTap = .distantPast
            pay()
        } else {
            lastTap = now
            Haptics.tap()
            state = .armed
            Task {
                try? await Task.sleep(for: .milliseconds(Int(Self.doublePressWindow * 1000)))
                if state == .armed, Date().timeIntervalSince(lastTap) >= Self.doublePressWindow {
                    state = .idle
                }
            }
        }
    }

    private func hold() {
        guard canPay else { return }
        pay()
    }

    private func pay() {
        guard canPay else { return }
        Haptics.firm()
        state = .paying
        Task {
            let body = CoveredAPI.ApproveBody(
                query: query,
                chosen: item.raw.chosenPayload,
                decision: decision,
                section: item.section,
                protectionPremiumPence: app.settings.protectionPremiumPence,
                chosenId: item.id
            )
            do {
                let done = try await app.api.approve(body)
                let balance = done.balancePence ?? max(0, app.balancePence - (item.pricePence ?? 0))
                app.balancePence = balance
                Haptics.success()
                state = .paid(id: done.id ?? "", balance: balance)
                onPaid("Paid \(item.priceLabel) to \(item.merchant) · wallet \(Money.format(balance))")
            } catch let error as APIError {
                Haptics.failure()
                if case .walletShort(let message) = error {
                    state = .short(message)
                } else {
                    state = .failed(error.message)
                }
            } catch {
                Haptics.failure()
                state = .failed(error.localizedDescription)
            }
        }
    }
}
