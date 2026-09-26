import LocalAuthentication
import SwiftUI

struct ApproveConfirm: View {
    let item: ShortlistItem
    let decision: Decision?
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
    @State private var ringDrawn = false

    var body: some View {
        ZStack {
            Color.backdrop
                .ignoresSafeArea()
                .onTapGesture { if !approveCheck { onDismiss() } }

            VStack {
                Spacer()
                sheet
                    .matchedGeometryEffect(id: "chosen-card", in: namespace)
            }
        }
    }

    @ViewBuilder
    private var sheet: some View {
        if approveCheck {
            successDisc
                .transition(.scale.combined(with: .opacity))
                .padding(.bottom, 80)
        } else {
            paySheet
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private var paySheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Capsule()
                .fill(Color.grabber)
                .frame(width: 36.5, height: 4.5)
                .frame(maxWidth: .infinity)

            if let shortfall = walletShortfallPence {
                shortBody(shortfall)
            } else {
                confirmBody
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.radiusSheet, style: .continuous))
    }

    private var confirmBody: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Covered wallet")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(Color.inkSoft)
                Spacer()
                Text(formatGBP(balancePence))
                    .filmMoney(21, weight: .semibold, tracking: -0.2)
                    .foregroundStyle(Color.inkSoft)
            }

            Rectangle().fill(Color.divider).frame(height: 1)

            HStack(alignment: .top, spacing: 12) {
                OfferPhoto(item: item, size: 66.5, corner: 13)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(item.title)
                            .font(.system(size: 18.5, weight: .semibold))
                            .tracking(-0.4)
                            .foregroundStyle(Color.inkSoft)
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        Text(item.priceLabel)
                            .filmMoney(21, weight: .semibold, tracking: -0.2)
                            .foregroundStyle(Color.inkSoft)
                            .accessibilityIdentifier("approve.price")
                            .accessibilityValue(item.priceLabel)
                    }
                    Text(item.merchant)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                }
            }

            Rectangle().fill(Color.divider).frame(height: 1)

            if let decision, isProtected(decision) {
                RightsChip()
            }

            HStack {
                Text("Total")
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(Color.inkSoft)
                Spacer()
                Text(item.priceLabel)
                    .filmMoney(25.5, weight: .bold, tracking: -0.5)
                    .foregroundStyle(Color.inkSoft)
            }

            if let shown = unlockError ?? errorText {
                Text(shown)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.secondary)
                    .accessibilityIdentifier("approve.error")
            }

            Button {
                Task { await confirm() }
            } label: {
                Text(unlocking ? "Waiting…" : "Confirm with Face ID")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.tertiary)
                    .frame(maxWidth: .infinity)
            }
            .disabled(unlocking)
            .accessibilityIdentifier("approve.confirm")
        }
    }

    private func shortBody(_ shortfall: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Covered wallet")
                    .font(.system(size: 14.5, weight: .medium))
                Spacer()
                Text(formatGBP(balancePence))
                    .filmMoney(21, weight: .semibold, tracking: -0.2)
            }
            Text(walletShortMessage ?? "Add \(formatGBP(shortfall)) to cover this listing.")
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
            InkPillButton(title: "Wallet", identifier: "approve.wallet") {
                onWallet()
            }
            QuietTextButton(title: "Cancel", action: onDismiss)
                .frame(maxWidth: .infinity)
        }
    }

    private var successDisc: some View {
        VStack(spacing: 22) {
            ZStack {
                Circle()
                    .fill(Color.accent)
                    .frame(width: Theme.successDisc, height: Theme.successDisc)
                SuccessCheck()
                    .stroke(Color.ink, style: StrokeStyle(lineWidth: 7.5, lineCap: .round, lineJoin: .round))
                    .frame(width: Theme.successDisc, height: Theme.successDisc)
                    .foregroundStyle(Color.ink)
            }
            .onAppear {
                withAnimation(Motion.snap) { ringDrawn = true }
            }

            if let approvedBalancePence {
                Text("Balance \(formatGBP(approvedBalancePence))")
                    .filmMoney(16.5, weight: .semibold, tracking: -0.2)
                    .foregroundStyle(Color.inkSoft)
                    .accessibilityIdentifier("approve.balance")
                    .accessibilityValue(formatGBP(approvedBalancePence))
            }

            Button("View order", action: onViewOrder)
                .font(.system(size: 18.5, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 220, height: 52)
                .background(Color.ink, in: Capsule())
                .accessibilityIdentifier("approve.viewOrder")
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

struct SuccessCheck: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 40 / 128, y: rect.minY + rect.height * 66 / 128))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 56 / 128, y: rect.minY + rect.height * 81 / 128))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 89 / 128, y: rect.minY + rect.height * 47 / 128))
        return path
    }
}

func confirmWithFaceID() async throws -> Bool {
    #if DEBUG
    if LaunchFlags.bypassAuth { return true }
    #endif
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        throw APIError.unexpected(message: authError?.localizedDescription ?? "This device cannot confirm you.")
    }
    return try await context.evaluatePolicy(
        .deviceOwnerAuthentication,
        localizedReason: "Confirm this from your Covered wallet."
    )
}
