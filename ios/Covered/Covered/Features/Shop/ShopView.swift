import SwiftUI

struct ShopView: View {
    @State private var shop = ShopModel()
    @State private var confirming = false
    @State private var limitItem: ShortlistItem?
    @State private var limitPounds = ""
    @State private var limitError: String?
    @State private var savingPremium = false
    @State private var removeError: String?
    @Namespace private var morph
    @FocusState private var searchFocused: Bool
    private let state = AppState.shared

    var body: some View {
        NavigationStack {
            ZStack {
                Color.screen
                VStack(spacing: 0) {
                    ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        ComposerBar(
                            text: $shop.query,
                            placeholder: shop.judgedQuery.isEmpty ? "Message Covered" : shop.judgedQuery,
                            identifier: "shop.search",
                            sendIdentifier: "shop.searchButton",
                            focused: $searchFocused,
                            enabled: !shop.isBusy,
                            onSend: runSearch
                        )

                        watchingStrip

                        if isFleeceDemoQuery(shop.query) {
                            Button {
                                searchFocused = false
                                Task { await shop.searchFixtures() }
                            } label: {
                                Text("Demo")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.tertiary)
                                    .padding(.horizontal, 10)
                                    .frame(height: 26)
                                    .background(Color.chipNeutral, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(shop.isBusy)
                            .accessibilityIdentifier("shop.demo")
                            .accessibilityLabel("Demo")
                        }

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
                    .padding(.horizontal, Theme.inset)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .opacity(confirming ? 0.08 : 1)

            if confirming, let chosen = shop.chosenItem {
                ApproveConfirm(
                    item: chosen,
                    decision: shop.decisions[chosen.id],
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
            }
            }
            .navigationTitle("Shop")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.screen, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .animation(Motion.merge, value: confirming)
            .animation(Motion.ui, value: shop.phase)
            .sheet(item: $limitItem) { item in
                limitSheet(item)
            }
            .task {
                shop.localPremiumBps = AppState.shared.settings.protectionPremiumBps
                await AppState.shared.refresh()
                if let seeded = LaunchFlags.seededSearchQuery, shop.query.isEmpty {
                    shop.query = seeded
                }
            }
        }
    }

    @ViewBuilder
    private var results: some View {
        HStack {
            Text(countLabel)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
            Spacer()
            Menu {
                Picker("Sort", selection: $shop.sort) {
                    ForEach(SortKey.allCases) { key in
                        Text(key.label).tag(key)
                    }
                }
            } label: {
                Text(shop.sort.label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.secondary)
            }
        }

        if let chosen = shop.chosenItem {
            approveSummary(chosen)
            if !useTwoUp {
                rejectedStrip
            }
            DualBuyActions(
                limitEnabled: !isMonthlyOnly(chosen),
                onBuy: { openApprove() },
                onLimit: { openLimit(chosen) }
            )
            .matchedGeometryEffect(id: "chosen-card", in: morph)

            PremiumControl(
                value: Binding(
                    get: { shop.localPremiumBps },
                    set: { shop.applyLocalPremium($0) }
                ),
                unit: .percentBps,
                discountBps: premiumDiscountBps,
                gapHighPence: premiumPair?.protected.pricePence,
                gapLowPence: premiumPair?.unprotected.pricePence,
                shopWins: shopWins,
                verdictLead: verdictLead,
                verdictBody: shop.verdict?.summary ?? "",
                identifier: "shop.premium",
                onEditingChanged: { editing in
                    if !editing { Task { await savePremium() } }
                }
            )
            .padding(.top, 4)
        } else {
            rejectedStrip
        }

        if useTwoUp {
            HStack(alignment: .top, spacing: 11) {
                ForEach(visibleRows) { item in
                    listingCard(item, twoUp: true)
                }
            }
            .accessibilityIdentifier("shop.results")
            rejectedStrip
        } else if !monthlyRows.isEmpty {
            listingGroup(title: "Pay outright", items: cashRows)
            listingGroup(title: "Pay monthly", items: monthlyRows)
        } else {
            LazyVStack(spacing: 10) {
                ForEach(visibleRows) { item in
                    listingCard(item)
                        .transition(.opacity)
                }
            }
            .accessibilityIdentifier("shop.results")
        }
    }

    @ViewBuilder
    private var rejectedStrip: some View {
        if !rejectedRows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(rejectedRows) { item in
                    listingCard(item, compact: true)
                }
            }
            .accessibilityIdentifier("shop.rejected")
        }
    }

    private func listingCard(_ item: ShortlistItem, twoUp: Bool = false, compact: Bool = false) -> some View {
        ListingCard(
            item: item,
            decision: shop.decisions[item.id],
            chosen: item.id == shop.verdict?.chosenId,
            twoUp: twoUp,
            compact: compact,
            namespace: morph,
            onApprove: { openApprove() },
            limitEnabled: !isMonthlyOnly(item),
            onLimit: { openLimit(item) }
        )
    }

    @ViewBuilder
    private var watchingStrip: some View {
        if !state.limits.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Watching")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.inkSoft)
                if let removeError {
                    Text(removeError)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                }
                ForEach(state.limits) { limit in
                    LimitRowView(limit: limit)
                        .contextMenu {
                            Button("Remove", role: .destructive) {
                                Task { await removeLimit(id: limit.id) }
                            }
                        }
                }
            }
            .accessibilityIdentifier("shop.watching")
        }
    }

    private func approveSummary(_ item: ShortlistItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            OfferPhoto(item: item, size: 80.5, corner: 14.5)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.merchant)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(Color.inkSoft)
                Text(item.title)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
                    .lineLimit(2)
                if let decision = shop.decisions[item.id], isProtected(decision) {
                    RightsChip(compact: true)
                }
            }
        }
        .padding(.top, 8)
    }

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !shop.query.isEmpty {
                SentBubble(text: shop.query)
            }
            TypingDots()
            Text(shop.statusText.isEmpty ? "Working…" : shop.statusText)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
                .accessibilityIdentifier("shop.status")
            ForEach(0..<3, id: \.self) { _ in
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: Theme.radiusPhoto, style: .continuous)
                        .fill(Color.photoHole)
                        .frame(width: 130, height: 130)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4).fill(Color.photoHole).frame(width: 90, height: 22)
                        RoundedRectangle(cornerRadius: 4).fill(Color.photoHole).frame(width: 160, height: 12)
                        RoundedRectangle(cornerRadius: 4).fill(Color.photoHole).frame(width: 120, height: 12)
                    }
                    Spacer()
                }
                .padding(13)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                        .strokeBorder(Color.hairline, lineWidth: 1)
                )
            }
        }
    }

    private var idleState: some View {
        Text("Buy it now, or set a limit and your laptop checks every hour.")
            .font(.system(size: 14.5))
            .foregroundStyle(Color.secondary)
            .padding(.top, 24)
    }

    private var emptyState: some View {
        Text("No listings came back for that search.")
            .font(.system(size: 14.5))
            .foregroundStyle(Color.secondary)
            .padding(.top, 24)
    }

    private func errorState(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Could not finish the search")
                .font(.system(size: 17.5, weight: .semibold))
                .foregroundStyle(Color.inkSoft)
            Text(message)
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
                .accessibilityIdentifier("shop.error")
        }
        .padding(.top, 16)
    }

    private func limitSheet(_ item: ShortlistItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Set a limit")
                .headline(29)
            Text(item.title)
                .font(.system(size: 14.5))
                .foregroundStyle(Color.secondary)
            HStack {
                Text("£")
                    .filmMoney(22, weight: .semibold)
                TextField("0", text: $limitPounds)
                    .keyboardType(.decimalPad)
                    .filmMoney(22, weight: .semibold)
                    .accessibilityIdentifier("shop.limitPounds")
            }
            if let limitError {
                Text(limitError)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
            }
            InkPillButton(title: "Confirm", identifier: "shop.limitConfirm") {
                Task { await saveLimit(item) }
            }
            Spacer()
        }
        .padding(24)
        .presentationDetents([.height(280)])
        .background(Color.screen)
    }

    private func isRejected(_ item: ShortlistItem) -> Bool {
        guard let decision = shop.decisions[item.id] else { return false }
        return decision.mislisting || !decision.sameItem
    }

    private var rejectedRows: [ShortlistItem] {
        shop.rows.filter(isRejected)
    }

    private var visibleRows: [ShortlistItem] {
        shop.rows.filter { !isRejected($0) }
    }

    private var cashRows: [ShortlistItem] {
        visibleRows.filter { !isMonthlyOnly($0) }
    }

    private var monthlyRows: [ShortlistItem] {
        visibleRows.filter(isMonthlyOnly)
    }

    @ViewBuilder
    private func listingGroup(title: String, items: [ShortlistItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.secondary)
            if items.isEmpty {
                Text("No cash prices in this search.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.secondary)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(items) { item in
                        listingCard(item)
                            .transition(.opacity)
                    }
                }
            }
        }
        .accessibilityIdentifier(title == "Pay outright" ? "shop.results" : "shop.monthly")
    }

    private var useTwoUp: Bool {
        visibleRows.count == 2 && shop.rows.contains { item in
            guard let decision = shop.decisions[item.id] else { return false }
            return decision.mislisting || !decision.sameItem
        }
    }

    private var countLabel: String {
        let left = visibleRows.count
        if left == shop.rows.count {
            return left == 1 ? "1 listing" : "\(left) listings"
        }
        return left == 1 ? "1 left" : "\(left) left"
    }

    private var premiumPair: (protected: ShortlistItem, unprotected: ShortlistItem)? {
        let survivors = survivorsForPremium(items: shop.items, decisions: shop.decisions)
        let protectedBest = cheapest(survivors.filter { item in
            guard let d = shop.decisions[item.id] else { return false }
            return isProtected(d)
        })
        let unprotectedBest = cheapest(survivors.filter { item in
            guard let d = shop.decisions[item.id] else { return true }
            return !isProtected(d)
        })
        if let protectedBest, let unprotectedBest { return (protectedBest, unprotectedBest) }
        return nil
    }

    private var premiumDiscountBps: Int? {
        guard let pair = premiumPair,
              let high = pair.protected.pricePence,
              let low = pair.unprotected.pricePence
        else { return nil }
        return discountRatioBps(protected: high, unprotected: low)
    }

    private var shopWins: Bool {
        guard let pair = premiumPair,
              let high = pair.protected.pricePence,
              let low = pair.unprotected.pricePence
        else { return true }
        return shopBeatsPremium(protected: high, unprotected: low, bps: shop.localPremiumBps)
    }

    private var verdictLead: String {
        guard let discount = premiumDiscountBps else {
            return shop.verdict?.summary.split(separator: ".").first.map(String.init) ?? ""
        }
        let cap = formatPercentBps(shop.localPremiumBps)
        let gap = formatPercentBps(discount)
        if shopWins {
            return "\(gap) ≤ \(cap) · shop wins"
        }
        return "\(gap) > \(cap) · private wins"
    }

    private func openApprove() {
        shop.resetReceipt()
        withAnimation(Motion.merge) { confirming = true }
    }

    private func openLimit(_ item: ShortlistItem) {
        limitPounds = poundsText(item.pricePence)
        limitError = nil
        limitItem = item
    }

    private func removeLimit(id: String) async {
        removeError = nil
        do {
            try await state.deleteLimit(id: id)
        } catch {
            removeError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func runSearch() {
        searchFocused = false
        Task { await shop.search() }
    }

    private func closeConfirm() {
        withAnimation(Motion.soft) { confirming = false }
        shop.resetReceipt()
    }

    private func savePremium() async {
        guard !savingPremium else { return }
        savingPremium = true
        var next = AppState.shared.settings
        next.protectionPremiumBps = shop.localPremiumBps
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
        if pence % 100 == 0 { return String(pence / 100) }
        return String(format: "%.2f", Double(pence) / 100)
    }
}

struct HomeView: View {
    var body: some View {
        ShopView()
    }
}
