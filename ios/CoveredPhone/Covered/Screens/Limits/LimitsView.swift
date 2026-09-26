// Watch-and-buy limits. The phone stores and lists them; the hourly check
// runs from the desktop extension (`/api/limits/run`) because the phone cannot
// open Google in the background.
import SwiftUI

struct LimitDraft: Identifiable, Hashable {
    var query: String
    var pricePence: Int?
    var id: String { "\(query)|\(pricePence ?? -1)" }
}

@MainActor
@Observable
final class LimitsStore {
    var limits: [Limit] = []
    var loading = false
    var error: String?

    let api = CoveredAPI.shared

    func refresh() async {
        loading = limits.isEmpty
        defer { loading = false }
        do {
            limits = try await api.limits()
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func create(query: String, maxPricePence: Int) async throws {
        limits = try await api.createLimit(query: query, maxPricePence: maxPricePence)
    }

    func remove(id: String) async {
        do {
            limits = try await api.deleteLimit(id: id)
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

struct LimitsView: View {
    @State private var store = LimitsStore()
    @State private var draft: LimitDraft?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandMark().padding(.top, 12)
                HStack(alignment: .firstTextBaseline) {
                    Text("Limits").headline(30)
                    Spacer()
                    Button {
                        draft = LimitDraft(query: "", pricePence: nil)
                    } label: {
                        Label("New", systemImage: "plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                Text("Tell Covered the most you would pay for something. It watches the shelf and buys only if the listing is the same item, not a mislisting, allowed by your premium, at or under the cap, and covered by the wallet.")
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .foregroundStyle(Theme.muted)

                if store.loading {
                    ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.vertical, 30)
                } else if store.limits.isEmpty {
                    Text("No limits yet. Set one from a result row, or from the search field.")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                                .strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 5]))
                        )
                } else {
                    VStack(spacing: 10) {
                        ForEach(store.limits) { limit in
                            LimitRow(limit: limit) {
                                Task { await store.remove(id: limit.id) }
                            }
                        }
                    }
                    .animation(Motion.spring, value: store.limits.map(\.id))
                }

                if let error = store.error {
                    Text(error).font(.system(size: 13)).foregroundStyle(Theme.danger)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Where the check runs")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.foreground)
                    Text("The hourly re-read of each watching query runs from the desktop Covered reader extension in your own browser, which posts fresh offers to the server. The server route exists; the phone cannot open Google in the background, so a limit set here fills when the desktop reader next checks.")
                        .font(.system(size: 13))
                        .lineSpacing(3)
                        .foregroundStyle(Theme.muted)
                }
                .padding(16)
                .panelCard()
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(Theme.background)
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
        .sheet(item: $draft) { draft in
            LimitEditorSheet(draft: draft, store: store)
                .presentationDetents([.height(320)])
                .presentationBackground(Theme.panel)
        }
    }
}

struct LimitRow: View {
    let limit: Limit
    let onRemove: () -> Void

    private var statusText: String {
        switch limit.status {
        case .watching: return "watching"
        case .filled: return "filled"
        case .paused: return "paused"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(limit.query)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.foreground)
                HStack(spacing: 8) {
                    Chip(text: statusText, accent: limit.status == .filled)
                    Text("up to \(Money.format(limit.maxPricePence))")
                        .font(.system(size: 13))
                        .tabular()
                        .foregroundStyle(Theme.muted)
                }
                Text(limit.lastCheckedAt.isEmpty
                     ? "Not checked yet"
                     : "Checked \(Dates.short(limit.lastCheckedAt))\(limit.lastResult.isEmpty ? "" : " · \(limit.lastResult)")")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(3)
            }
            Spacer()
            Button(role: .destructive, action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(Theme.panelRaised))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove limit")
        }
        .padding(14)
        .panelCard()
    }
}

/// Query + cap. Used from the Limits tab and from Home (result row or search field).
struct LimitEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let draft: LimitDraft
    var store: LimitsStore? = nil

    @State private var query = ""
    @State private var pence = 0
    @State private var busy = false
    @State private var error: String?
    @State private var saved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Buy it for me if it drops to").headline(20)
            TextField("What to watch", text: $query)
                .font(.system(size: 16))
                .foregroundStyle(Theme.foreground)
                .autocorrectionDisabled()
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panelRaised).overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line)))
            PoundField(label: "Maximum price in pounds", pence: $pence, large: true)
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(Theme.danger)
            }
            HStack {
                Button("Cancel") { dismiss() }.buttonStyle(QuietButtonStyle())
                Spacer()
                Button(saved ? "Watching" : (busy ? "Saving…" : "Watch and buy")) { save() }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || saved || query.trimmingCharacters(in: .whitespaces).isEmpty || pence <= 0)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            query = draft.query
            pence = draft.pricePence ?? 0
        }
    }

    private func save() {
        busy = true
        error = nil
        let target = store ?? LimitsStore()
        Task {
            do {
                try await target.create(query: query.trimmingCharacters(in: .whitespaces), maxPricePence: pence)
                saved = true
                Haptics.success()
                try? await Task.sleep(for: .milliseconds(500))
                dismiss()
            } catch {
                self.error = (error as? APIError)?.message ?? error.localizedDescription
                Haptics.failure()
            }
            busy = false
        }
    }
}
