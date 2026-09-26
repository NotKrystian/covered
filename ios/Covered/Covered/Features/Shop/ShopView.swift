import SwiftUI

struct ShopView: View {
    @State private var shop = ShopModel()
    @State private var confirming = false
    @State private var limitItem: ShortlistItem?
    @State private var limitPounds = ""
    @State private var limitError: String?
    @State private var savingPremium = false
    @Namespace private var morph
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color.canvas.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.pad) {
                        searchBar
                        if shop.isBusy {
                            loadingState
                        } else if let error = shop.errorText, shop.items.isEmpty {
                            errorState(error)
                        } else if shop.items.isEmpty && !shop.judgedQuery.isEmpty {
                            emptyState
                        } else if !shop.items.isEmpty {
                            results
                        } else {
                            idleState
                        }
                    }
                    .padding(Theme.pad)
                    .padding(.bottom, 40)
                }
                .scrollDismissesKeyboard(.interactively)
                .opacity(confirming ? 0.15 : 1)

                if confirming, let chosen = shop.chosenItem {
                    ApproveConfirm(
                        item: chosen,
                        balancePence: AppState.shared.wallet?.balancePence ?? 0,
                        namespace: morph,
                        onConfirm: { await shop.approve(item: chosen) },
                        onDismiss: { closeConfirm() },
                        onViewOrder: {
                            closeConfirm()
                            CoveredTabs.shared.open(.orders)
                        },
                        onWallet: {
                            closeConfirm()
                            CoveredTabs.shared.open(.wallet)
                        },
                        approveCheck: shop.approveCheck,
                        approvedBalancePence: shop.approvedBalancePence,
                        walletShortfallPence: shop.walletShortfallPence,
                        walletShortMessage: shop.walletShortMessage,
                        errorText: shop.errorText
                    )
                    .transition(.blurReplace)
                }
            }
            .navigationTitle("Shop")
            .navigationBarTitleDisplayMode(.inline)
            .animation(.spring(response: 0.35, dampingFraction: 0.9), value: confirming)
            .animation(.spring(response: 0.35, dampingFraction: 0.9), value: shop.phase)
            .sheet(item: $limitItem) { item in
                limitSheet(item)
            }
            .task {
                shop.localPremiumPence = AppState.shared.settings.protectionPremiumPence
                if AppState.shared.wallet == nil {
                    await AppState.shared.refresh()
                }
                if let seeded = LaunchFlags.seededSearchQuery, shop.query.isEmpty {
                    shop.query = seeded
                }
            }
        }
    }

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("What do you want to buy?", text: $shop.query)
                    .font(.ui(17))
                    .foregroundStyle(Color.canvas)
                    .focused($searchFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("shop.search")
                    .onSubmit { runSearch() }
                    .disabled(shop.isBusy)
                Button("Search") { runSearch() }
                    .buttonStyle(CoveredPrimaryButtonStyle())
                    .disabled(shop.isBusy || shop.query.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("shop.searchButton")
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .fill(Color.ink)
            )
        }
    }

    @ViewBuilder
    private var results: some View {
        if let summary = shop.verdict?.summary, !summary.isEmpty {
            Text(summary)
                .font(.ui(16))
                .lineSpacing(4)
                .foregroundStyle(Color.ink)
        }

        premiumSlider

        HStack {
            if !shop.sourceLabel.isEmpty {
                Text(shop.sourceLabel)
                    .font(.ui(13))
                    .foregroundStyle(Color.muted)
            }
            Spacer()
            Menu {
                Picker("Sort", selection: $shop.sort) {
                    ForEach(SortKey.allCases) { key in
                        Text(key.label).tag(key)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(shop.sort.label)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                }
                .font(.ui(13))
                .foregroundStyle(Color.muted)
            }
        }

        LazyVStack(spacing: 12) {
            ForEach(shop.rows) { item in
                ListingCard(
                    item: item,
                    decision: shop.decisions[item.id],
                    chosen: item.id == shop.verdict?.chosenId,
                    namespace: morph,
                    onApprove: {
                        shop.resetReceipt()
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                            confirming = true
                        }
                    },
                    onLimit: {
                        limitPounds = poundsText(item.pricePence)
                        limitError = nil
                        limitItem = item
                    }
                )
                .transition(.blurReplace)
            }
        }
        .accessibilityIdentifier("shop.results")
    }

    private var premiumSlider: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pay up to \(formatGBP(shop.localPremiumPence))")
                .font(.money(16, weight: .semibold))
                .foregroundStyle(Color.ink)
                .contentTransition(.numericText())
                .animation(.spring(response: 0.35, dampingFraction: 0.9), value: shop.localPremiumPence)
            Slider(
                value: Binding(
                    get: { Double(shop.localPremiumPence) },
                    set: { shop.applyLocalPremium(Int($0.rounded())) }
                ),
                in: 0...3_000,
                step: 100
            ) { editing in
                if !editing {
                    Task { await savePremium() }
                }
            }
            .tint(Color.accent)
        }
        .padding(.vertical, 4)
    }

    private var loadingState: some View {
        VStack(spacing: 14) {
            ProgressView().tint(Color.accent)
            Text(shop.statusText.isEmpty ? "Working…" : shop.statusText)
                .font(.ui(15))
                .foregroundStyle(Color.muted)
                .accessibilityIdentifier("shop.status")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.ink)
        )
        .foregroundStyle(Color.canvas)
    }

    private var idleState: some View {
        Text("Search for something. Covered buys the cheapest listing that is actually the item and still has your rights.")
            .font(.ui(15))
            .foregroundStyle(Color.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .padding(.horizontal, 12)
    }

    private var emptyState: some View {
        Text("No listings came back for that search.")
            .font(.ui(15))
            .foregroundStyle(Color.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
    }

    private func errorState(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Could not finish the search")
                .font(.ui(20, weight: .semibold))
                .foregroundStyle(Color.canvas)
            Text(message)
                .font(.ui(15))
                .foregroundStyle(Color.muted)
                .accessibilityIdentifier("shop.error")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .fill(Color.ink)
        )
    }

    private func limitSheet(_ item: ShortlistItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Set a limit")
                .font(.ui(22, weight: .semibold))
            Text(item.title)
                .font(.ui(15))
                .foregroundStyle(Color.muted)
            HStack {
                Text("£")
                    .font(.money(22))
                TextField("0", text: $limitPounds)
                    .keyboardType(.decimalPad)
                    .font(.money(22))
            }
            if let limitError {
                Text(limitError)
                    .font(.ui(13))
                    .foregroundStyle(Color.muted)
            }
            Button("Save limit") {
                Task { await saveLimit(item) }
            }
            .buttonStyle(CoveredPrimaryButtonStyle())
            Spacer()
        }
        .padding(24)
        .presentationDetents([.height(280)])
        .background(Color.canvas)
    }

    private func runSearch() {
        searchFocused = false
        Task { await shop.search() }
    }

    private func closeConfirm() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
            confirming = false
        }
        shop.resetReceipt()
    }

    private func savePremium() async {
        guard !savingPremium else { return }
        savingPremium = true
        var next = AppState.shared.settings
        next.protectionPremiumPence = shop.localPremiumPence
        do {
            try await AppState.shared.saveSettings(settings: next)
        } catch {
            shop.errorText = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        savingPremium = false
    }

    private func saveLimit(_ item: ShortlistItem) async {
        let pence = parsePricePence("£\(limitPounds)") ?? item.pricePence ?? 0
        guard pence > 0 else {
            limitError = "Enter an amount in pounds."
            return
        }
        do {
            try await shop.createLimit(for: item, maxPence: pence)
            Haptics.success()
            limitItem = nil
        } catch {
            limitError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func poundsText(_ pence: Int?) -> String {
        guard let pence else { return "" }
        let pounds = Double(pence) / 100
        if pence % 100 == 0 { return String(pence / 100) }
        return String(format: "%.2f", pounds)
    }
}

/// RootView still looks for this name.
struct HomeView: View {
    var body: some View {
        ShopView()
    }
}