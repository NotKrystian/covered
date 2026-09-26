// Consumer home: greeting, wallet, one search field that morphs into the
// results header, the verdict sentence, and every judged row.
import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var shop = ShopModel()
    @Namespace private var morph
    @FocusState private var fieldFocused: Bool

    @State private var approveOpen = false
    @State private var limitDraft: LimitDraft?
    @State private var link: WebLink?
    @State private var prefsOpen = false
    @State private var depositOpen = false

    private var showsHeader: Bool { shop.result != nil && !shop.editing && !shop.running }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                searchArea
                    .padding(.top, 4)
                body_
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
        .sheet(isPresented: $approveOpen) {
            if let result = shop.result, let chosen = shop.chosenItem, let decision = result.decisions[chosen.id] {
                ApproveSheet(
                    query: shop.judgedQuery,
                    item: chosen,
                    decision: decision,
                    onPaid: { line in shop.receiptLine = line }
                )
                .presentationDetents([.height(440)])
                .presentationDragIndicator(.hidden)
                .presentationBackground(Theme.panel)
            }
        }
        .sheet(item: $limitDraft) { draft in
            LimitEditorSheet(draft: draft)
                .presentationDetents([.height(320)])
                .presentationBackground(Theme.panel)
        }
        .sheet(item: $link) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .sheet(isPresented: $depositOpen) {
            DepositSheet()
                .presentationDetents([.height(300)])
                .presentationBackground(Theme.panel)
        }
        .task {
            await app.refreshWallet()
            if LaunchFlags.demoFixtures, shop.result == nil, !shop.running {
                await shop.runFixtures(settings: app.settings, displayName: app.displayName)
                if LaunchFlags.demoApprove, shop.chosenItem != nil {
                    approveOpen = true
                }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            BrandMark()
            HStack(alignment: .firstTextBaseline) {
                Text(app.greeting)
                    .headline(30)
                Spacer()
                Button { depositOpen = true } label: {
                    HStack(spacing: 6) {
                        Text("Wallet")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                        Text(Money.format(app.balancePence))
                            .font(.system(size: 15, weight: .semibold))
                            .tabular()
                            .foregroundStyle(Theme.foreground)
                            .contentTransition(.numericText())
                            .animation(Motion.spring, value: app.balancePence)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Theme.panelRaised).overlay(Capsule().strokeBorder(Theme.line)))
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 14) {
                Text("Pay up to \(Money.format(app.settings.protectionPremiumPence)) more for rights")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                Button(prefsOpen ? "Done" : "Change") {
                    withAnimation(Motion.spring) { prefsOpen.toggle() }
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.accent)
            }
            if prefsOpen {
                PreferencesStrip()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: Search field ⇄ results header (one shape)

    private var searchArea: some View {
        ZStack {
            if showsHeader {
                resultsHeader
            } else {
                searchField
            }
        }
        .animation(Motion.spring, value: showsHeader)
    }

    private var shape: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Theme.panel)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(fieldFocused ? Theme.accent : Theme.line))
            .matchedGeometryEffect(id: "search-shape", in: morph)
    }

    private var searchField: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                TextField("What do you want to buy?", text: $shop.query)
                    .font(.system(size: 17))
                    .foregroundStyle(Theme.foreground)
                    .focused($fieldFocused)
                    .submitLabel(.search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { runSearch() }
                    .disabled(shop.running)
                Button { runSearch() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.background)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Theme.accent))
                }
                .buttonStyle(.plain)
                .disabled(shop.running || shop.query.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(shop.query.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            }
            .padding(.leading, 18)
            .padding(.trailing, 10)
            .padding(.vertical, 10)
            .background(shape)

            HStack(spacing: 12) {
                Button {
                    Task { await shop.runFixtures(settings: app.settings, displayName: app.displayName) }
                } label: {
                    Label("Fleece demo", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(QuietButtonStyle())
                .disabled(shop.running)
                Button {
                    limitDraft = LimitDraft(query: shop.query.trimmingCharacters(in: .whitespaces), pricePence: nil)
                } label: {
                    Label("Limit", systemImage: "gauge.with.dots.needle.33percent")
                }
                .buttonStyle(QuietButtonStyle())
                .disabled(shop.query.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
                if shop.result != nil {
                    Button("Cancel") {
                        withAnimation(Motion.spring) { shop.editing = false }
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private var resultsHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(shop.judgedQuery)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
                Text(shop.sourceLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer()
            Button("Edit") {
                withAnimation(Motion.spring) { shop.editing = true }
                fieldFocused = true
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.accent)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(shape)
    }

    private func runSearch() {
        fieldFocused = false
        Task { await shop.search(settings: app.settings, displayName: app.displayName) }
    }

    // MARK: Body

    @ViewBuilder
    private var body_: some View {
        if shop.running {
            VStack(spacing: 12) {
                ProgressView().tint(Theme.accent)
                Text("Reading the shelf and judging every listing…")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 56)
            .panelCard()
        } else if let failure = shop.failure {
            failureCard(failure)
        } else if let result = shop.result {
            resultsList(result)
        } else {
            Text("Search for something. Covered buys the cheapest listing that is actually the item and still has your rights.")
                .font(.system(size: 14))
                .lineSpacing(3)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
                .padding(.horizontal, 20)
                .background(
                    RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                        .strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                )
        }
    }

    private func failureCard(_ failure: SearchFailure) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(failure.title)
                .headline(20)
            Text(failure.message)
                .font(.system(size: 14))
                .lineSpacing(3)
                .foregroundStyle(Theme.muted)
            if failure.kind == .challenge {
                Button("Run the fleece demo") {
                    Task { await shop.runFixtures(settings: app.settings, displayName: app.displayName) }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .panelCard()
    }

    private func resultsList(_ result: DecideResponse) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(result.verdict.summary)
                .font(.system(size: 16))
                .lineSpacing(4)
                .foregroundStyle(shop.chosenIsProtected ? Theme.accent : Theme.foreground)

            HStack(spacing: 8) {
                Chip(text: "\(result.mode) · \(result.listings.count) judged")
                if result.learned { Chip(text: "learned", accent: true) }
            }

            if let receipt = shop.receiptLine {
                Text(receipt)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.foreground)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Theme.accentSoft)
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.accent.opacity(0.4)))
                    )
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            if shop.rows.isEmpty {
                Text("No listings came back for that search.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
            } else {
                HStack {
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
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                    }
                }

                LazyVStack(spacing: 12) {
                    ForEach(shop.rows) { item in
                        ListingRow(
                            item: item,
                            decision: result.decisions[item.id],
                            chosen: item.id == shop.chosenId,
                            onApprove: { approveOpen = true },
                            onLimit: { limitDraft = LimitDraft(query: shop.judgedQuery, pricePence: item.pricePence) },
                            onOpen: { url in link = WebLink(url: url) }
                        )
                        .transition(.opacity)
                    }
                }
                .animation(Motion.spring, value: shop.rows.map(\.id))
            }
        }
    }
}

// MARK: - Preferences strip

private struct PreferencesStrip: View {
    @Environment(AppModel.self) private var app
    @State private var draft: UserSettings = .defaults
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text("Pay up to").font(.system(size: 13)).foregroundStyle(Theme.muted)
                PoundField(label: "Protection premium in pounds", pence: $draft.protectionPremiumPence)
                    .frame(width: 96)
                Text("more for rights").font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            HStack(spacing: 10) {
                Text("Switch if I clear").font(.system(size: 13)).foregroundStyle(Theme.muted)
                PoundField(label: "Switch minimum in pounds", pence: $draft.switchMinimumPence)
                    .frame(width: 96)
                Spacer()
                Button(saving ? "Saving…" : "Save") {
                    saving = true
                    Task {
                        do { try await app.savePreferences(draft) } catch { self.error = (error as? APIError)?.message ?? error.localizedDescription }
                        saving = false
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving)
            }
            if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger)
            }
        }
        .padding(14)
        .panelCard()
        .onAppear { draft = app.settings }
    }
}

// MARK: - Deposit sheet

struct DepositSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var pence = 4000
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Deposit into the wallet").headline(20)
                Spacer()
                Text(Money.format(app.balancePence)).font(.system(size: 14)).tabular().foregroundStyle(Theme.muted)
            }
            Text("Demo money only. No card is charged. Max £500 per deposit.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
            PoundField(label: "Deposit amount in pounds", pence: $pence, large: true)
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(Theme.danger)
            }
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(QuietButtonStyle())
                Spacer()
                Button(busy ? "Depositing…" : "Deposit") {
                    busy = true
                    Task {
                        do {
                            try await app.deposit(pence: pence)
                            Haptics.success()
                            dismiss()
                        } catch {
                            self.error = (error as? APIError)?.message ?? error.localizedDescription
                            Haptics.failure()
                        }
                        busy = false
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || pence <= 0)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
