import SwiftUI

struct WalletView: View {
    private let state = AppState.shared

    @State private var customPounds = ""
    @State private var depositError: String?
    @State private var depositing = false
    @State private var selectedChip: Int?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    balanceBlock
                    depositBlock
                    historyBlock
                    shopLimitsLink
                }
                .padding(.horizontal, Theme.inset)
                .padding(.bottom, 24)
            }
            .background(Color.screen)
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.screen, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    WalletChip(pence: state.wallet?.balancePence ?? 0)
                }
            }
            .refreshable { await state.refresh() }
            .task { await state.refresh() }
        }
        .tint(Color.ink)
    }

    private var balanceBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Covered wallet")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
            CountingBalance(pence: state.wallet?.balancePence ?? 0)
            Text("Demo wallet · no card is charged")
                .font(.system(size: 13))
                .foregroundStyle(Color.tertiary)
        }
    }

    private var depositBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ForEach([50, 100, 500], id: \.self) { pounds in
                    depositChip(pounds)
                }
            }
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    Text("£")
                        .filmMoney(17, weight: .medium)
                    TextField("Custom", text: $customPounds)
                        .keyboardType(.decimalPad)
                        .filmMoney(17, weight: .medium)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.panel, in: Capsule())
            }
            InkPillButton(title: depositing ? "…" : "Deposit", enabled: !depositing && parseCustomPence() != nil) {
                Task { await depositCustom() }
            }
            if let depositError {
                Text(depositError)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
                    .coveredSwap()
            }
        }
    }

    private func depositChip(_ pounds: Int) -> some View {
        let selected = selectedChip == pounds
        return Button {
            customPounds = "\(pounds)"
            selectedChip = pounds
            Task { await deposit(pence: pounds * 100) }
        } label: {
            Text("£\(pounds)")
                .font(.money(15, weight: .semibold))
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background((selected ? Color.accent : Color.panel), in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(depositing)
    }

    private var historyBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("History")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
                .padding(.bottom, 8)
            let deposits = Array((state.wallet?.deposits ?? []).suffix(20).reversed())
            if deposits.isEmpty {
                Text("No deposits yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
            } else {
                ForEach(Array(deposits.enumerated()), id: \.offset) { _, deposit in
                    HStack {
                        Text(LimitStatusChip.depositDateLabel(deposit.t))
                            .font(.system(size: 14))
                            .foregroundStyle(Color.inkSoft)
                        Spacer()
                        Text(formatGBP(deposit.amountPence))
                            .filmMoney(14, weight: .semibold)
                            .foregroundStyle(Color.inkSoft)
                    }
                    .padding(.vertical, 10)
                    Rectangle().fill(Color.divider).frame(height: 1)
                }
            }
        }
    }

    private var shopLimitsLink: some View {
        Group {
            if !state.limits.isEmpty {
                Button {
                    CoveredTabs.shared.open(.shop)
                } label: {
                    Text(state.limits.count == 1 ? "1 limit watching · See on Shop" : "\(state.limits.count) limits watching · See on Shop")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.inkSoft)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("wallet.limitsLink")
            }
        }
    }

    private func parseCustomPence() -> Int? {
        let trimmed = customPounds.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return parsePricePence(trimmed.hasPrefix("£") ? trimmed : "£\(trimmed)")
    }

    private func depositCustom() async {
        guard let pence = parseCustomPence() else { return }
        await deposit(pence: pence)
    }

    private func deposit(pence: Int) async {
        depositing = true
        depositError = nil
        defer { depositing = false }
        do {
            try await state.deposit(pence: pence)
            Haptics.success()
            customPounds = ""
            selectedChip = nil
        } catch {
            depositError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct CountingBalance: View {
    let pence: Int
    @State private var shown = 0

    var body: some View {
        Text(formatGBP(shown))
            .filmMoney(58.5, weight: .bold, tracking: -2.3)
            .foregroundStyle(Color.inkSoft)
            .contentTransition(.numericText())
            .animation(Motion.money, value: shown)
            .accessibilityIdentifier("wallet.balance")
            .accessibilityValue(formatGBP(pence))
            .onAppear { shown = pence }
            .onChange(of: pence) { _, next in
                withAnimation(Motion.money) { shown = next }
            }
    }
}
