import SwiftUI

struct WalletView: View {
    private let state = AppState.shared

    @State private var customPounds = ""
    @State private var depositError: String?
    @State private var depositing = false
    @State private var selectedChip: Int?
    @State private var limitError: String?
    @State private var showNewLimit = false

    var body: some View {
        NavigationStack {
            List {
                balanceSection
                depositSection
                historySection
                limitsSection
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(Color.ink)
                            .accessibilityLabel("Settings")
                    }
                }
            }
            .refreshable { await state.refresh() }
            .task { await state.refresh() }
            .navigationDestination(isPresented: $showNewLimit) {
                NewLimitView()
            }
            .animation(Motion.spring, value: state.wallet?.balancePence)
            .animation(Motion.spring, value: state.limits.map(\.id))
        }
        .tint(Color.accent)
    }

    // MARK: - Balance

    private var balanceSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                CountingBalance(pence: state.wallet?.balancePence ?? 0)
                Text("Deposit into the bot wallet. Approve spends it.")
                    .font(.ui(15))
                    .foregroundStyle(Color.white.opacity(0.72))
                Text("Demo wallet · no card is charged")
                    .font(.ui(12))
                    .foregroundStyle(Color.white.opacity(0.45))
            }
            .padding(.vertical, 8)
            .listRowInsets(EdgeInsets(top: 16, leading: 20, bottom: 16, trailing: 20))
            .listRowBackground(walletCard)
            .listRowSeparator(.hidden)
        }
    }

    // MARK: - Deposit

    private var depositSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                Text("Deposit")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(.white)

                HStack(spacing: 8) {
                    ForEach([50, 100, 500], id: \.self) { pounds in
                        depositChip(pounds)
                    }
                }

                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Text("£")
                            .font(.money(17, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.55))
                        TextField("Custom", text: $customPounds)
                            .keyboardType(.decimalPad)
                            .font(.money(17))
                            .foregroundStyle(.white)
                            .monospacedDigit()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))

                    Button(depositing ? "…" : "Deposit") {
                        Task { await depositCustom() }
                    }
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.accent, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                    .disabled(depositing || parseCustomPence() == nil)
                    .opacity(depositing || parseCustomPence() == nil ? 0.5 : 1)
                }

                if let depositError {
                    Text(depositError)
                        .font(.ui(13))
                        .foregroundStyle(Color.dangerGrey)
                        .coveredSwap()
                }
            }
            .padding(.vertical, 6)
            .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20))
            .listRowBackground(walletCard)
            .listRowSeparator(.hidden)
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
                .foregroundStyle(selected ? Color.ink : .white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    (selected ? Color.accent : Color.white.opacity(0.1)),
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
        .disabled(depositing)
    }

    // MARK: - History

    private var historySection: some View {
        Section {
            let deposits = (state.wallet?.deposits ?? []).suffix(20).reversed()
            if deposits.isEmpty {
                Text("No deposits yet.")
                    .font(.ui(14))
                    .foregroundStyle(Color.muted)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(Array(deposits), id: \.self) { deposit in
                    HStack {
                        Text(LimitStatusChip.depositDateLabel(deposit.t))
                            .font(.ui(14))
                            .foregroundStyle(Color.ink)
                        Spacer()
                        Text(formatGBP(deposit.amountPence))
                            .font(.money(15, weight: .semibold))
                            .foregroundStyle(Color.ink)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20))
                    .listRowBackground(historyRow)
                    .listRowSeparatorTint(Color.ink.opacity(0.08))
                }
            }
        } header: {
            Text("History")
                .font(.ui(13, weight: .semibold))
                .foregroundStyle(Color.muted)
                .textCase(nil)
        }
    }

    // MARK: - Limits

    private var limitsSection: some View {
        Section {
            Text("Your laptop's Covered reader checks each limit every hour and buys only if it's the real item, keeps your rights, is at or under your price, and the wallet covers it.")
                .font(.ui(13))
                .foregroundStyle(Color.muted)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if let limitError {
                Text(limitError)
                    .font(.ui(13))
                    .foregroundStyle(Color.dangerGrey)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .coveredSwap()
            }

            if state.limits.isEmpty {
                Text("No limits yet.")
                    .font(.ui(14))
                    .foregroundStyle(Color.muted)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(state.limits) { limit in
                    LimitRowView(limit: limit)
                        .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { await deleteLimit(id: limit.id) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                }
            }

            Button {
                showNewLimit = true
            } label: {
                Text("New limit")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.accent, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 24, trailing: 20))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        } header: {
            Text("Limits")
                .font(.ui(13, weight: .semibold))
                .foregroundStyle(Color.muted)
                .textCase(nil)
        }
    }

    private var walletCard: some View {
        RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
            .fill(Color.ink)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
    }

    private var historyRow: some View {
        RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous)
            .fill(Color.white.opacity(0.55))
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
    }

    // MARK: - Actions

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

    private func deleteLimit(id: String) async {
        limitError = nil
        do {
            try await state.deleteLimit(id: id)
        } catch {
            limitError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct CountingBalance: View {
    let pence: Int
    @State private var shown = 0

    var body: some View {
        Text(formatGBP(shown))
            .font(.money(44, weight: .semibold))
            .foregroundStyle(.white)
            .contentTransition(.numericText())
            .animation(Motion.spring, value: shown)
            .accessibilityIdentifier("wallet.balance")
            .accessibilityValue(formatGBP(pence))
            .onAppear { shown = pence }
            .onChange(of: pence) { _, next in
                withAnimation(Motion.spring) { shown = next }
            }
    }
}
