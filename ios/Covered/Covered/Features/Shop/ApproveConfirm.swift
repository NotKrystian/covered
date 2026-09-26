import LocalAuthentication
import SwiftUI

struct ApproveConfirm: View {
    let item: ShortlistItem
    let balancePence: Int
    let namespace: Namespace.ID
    let onConfirm: () async -> Void
    let onDismiss: () -> Void
    let onViewOrder: () -> Void
    let onWallet: () -> Void

    let approveCheck: Bool
    let approvedBalancePence: Int?
    let walletShortfallPence: Int?
    let walletShortMessage: String?
    var errorText: String? = nil

    @State private var unlocking = false
    @State private var unlockError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if approveCheck {
                successBody
                    .transition(.blurReplace)
            } else if let shortfall = walletShortfallPence {
                shortBody(shortfall)
                    .transition(.blurReplace)
            } else {
                confirmBody
                    .transition(.blurReplace)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.ink)
        )
        .matchedGeometryEffect(id: "chosen-card", in: namespace)
        .padding(Theme.pad)
    }

    private var confirmBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Covered wallet · \(formatGBP(balancePence))")
                .font(.money(15, weight: .medium))
                .foregroundStyle(Color.muted)
            Text(item.title)
                .font(.ui(20, weight: .semibold))
                .foregroundStyle(Color.canvas)
            Text(item.priceLabel)
                .font(.money(28))
                .foregroundStyle(Color.canvas)
                .accessibilityIdentifier("approve.price")
                .accessibilityValue(item.priceLabel)
            if let shown = unlockError ?? errorText {
                Text(shown)
                    .font(.ui(14))
                    .foregroundStyle(Color.muted)
                    .accessibilityIdentifier("approve.error")
            }
            HStack {
                Button("Cancel", action: onDismiss)
                    .buttonStyle(CoveredQuietButtonStyle())
                Spacer()
                Button(unlocking ? "Waiting…" : "Confirm with Face ID") {
                    Task { await confirm() }
                }
                .buttonStyle(CoveredPrimaryButtonStyle())
                .disabled(unlocking)
                .accessibilityIdentifier("approve.confirm")
            }
        }
    }

    private var successBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            CheckMark()
                .frame(width: 56, height: 56)
            Text("Paid from the Covered wallet")
                .font(.ui(20, weight: .semibold))
                .foregroundStyle(Color.canvas)
            if let approvedBalancePence {
                Text("Balance \(formatGBP(approvedBalancePence))")
                    .font(.money(16))
                    .foregroundStyle(Color.accent)
                    .accessibilityIdentifier("approve.balance")
                    .accessibilityValue(formatGBP(approvedBalancePence))
            }
            Button("View order", action: onViewOrder)
                .buttonStyle(CoveredPrimaryButtonStyle())
                .accessibilityIdentifier("approve.viewOrder")
        }
    }

    private func shortBody(_ shortfall: Int) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Wallet is short")
                .font(.ui(20, weight: .semibold))
                .foregroundStyle(Color.canvas)
            Text(walletShortMessage ?? "Add \(formatGBP(shortfall)) to cover this listing.")
                .font(.ui(15))
                .foregroundStyle(Color.muted)
            Text("Short by \(formatGBP(shortfall))")
                .font(.money(18))
                .foregroundStyle(Color.canvas)
            HStack {
                Button("Cancel", action: onDismiss)
                    .buttonStyle(CoveredQuietButtonStyle())
                Spacer()
                Button("Wallet", action: onWallet)
                    .buttonStyle(CoveredPrimaryButtonStyle())
            }
        }
    }

    @MainActor
    private func confirm() async {
        unlocking = true
        unlockError = nil
        #if DEBUG
        if LaunchFlags.bypassAuth {
            await onConfirm()
            unlocking = false
            return
        }
        #endif
        let context = LAContext()
        var authError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
            unlockError = authError?.localizedDescription ?? "This device cannot confirm you."
            unlocking = false
            return
        }
        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Confirm this purchase from your Covered wallet."
            )
            guard ok else {
                unlockError = "Could not confirm it was you."
                unlocking = false
                return
            }
            await onConfirm()
        } catch {
            unlockError = error.localizedDescription
        }
        unlocking = false
    }
}

private struct CheckMark: View {
    @State private var drawn = false

    var body: some View {
        CheckShape()
            .trim(from: 0, to: drawn ? 1 : 0)
            .stroke(Color.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            .onAppear {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                    drawn = true
                }
            }
    }
}

private struct CheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.2, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.42, y: rect.maxY - rect.height * 0.22))
        path.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.18, y: rect.minY + rect.height * 0.22))
        return path
    }
}
