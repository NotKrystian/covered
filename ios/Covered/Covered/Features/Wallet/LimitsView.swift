import SwiftUI

/// Stand-alone limits screen (tab or push). Same data as the Wallet section.
struct LimitsView: View {
    private let state = AppState.shared
    @State private var limitError: String?

    var body: some View {
        NavigationStack {
            List {
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
                                    Task { await delete(id: limit.id) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }

                NavigationLink {
                    NewLimitView()
                } label: {
                    Text("New limit")
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.accent, in: RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 24, trailing: 20))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Limits")
            .refreshable { await state.refresh() }
            .task { await state.refresh() }
        }
        .tint(Color.accent)
    }

    private func delete(id: String) async {
        limitError = nil
        do {
            try await state.deleteLimit(id: id)
        } catch {
            limitError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct NewLimitView: View {
    private let state = AppState.shared
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var poundsText = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        List {
            Section {
                TextField("What to watch", text: $query)
                    .font(.ui(16))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .listRowBackground(Color.white.opacity(0.7))

                HStack(spacing: 6) {
                    Text("£")
                        .font(.money(17, weight: .medium))
                        .foregroundStyle(Color.muted)
                    TextField("Max price", text: $poundsText)
                        .keyboardType(.decimalPad)
                        .font(.money(17))
                        .foregroundStyle(Color.ink)
                }
                .listRowBackground(Color.white.opacity(0.7))
            } header: {
                Text("New limit")
                    .textCase(nil)
            } footer: {
                Text("buy at or under this price, only if it is the real item and the wallet covers it.")
            }

            if let error {
                Text(error)
                    .font(.ui(13))
                    .foregroundStyle(Color.dangerGrey)
                    .listRowBackground(Color.clear)
                    .coveredSwap()
            }

            Button(saving ? "Saving…" : "Watch and buy") {
                Task { await save() }
            }
            .font(.ui(15, weight: .semibold))
            .foregroundStyle(Color.ink)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.accent)
            .disabled(saving || !canSave)
            .opacity(saving || !canSave ? 0.5 : 1)
        }
        .scrollContentBackground(.hidden)
        .background(Color.canvas.ignoresSafeArea())
        .navigationTitle("New limit")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var canSave: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && parsedPence != nil
    }

    private var parsedPence: Int? {
        let trimmed = poundsText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return parsePricePence(trimmed.hasPrefix("£") ? trimmed : "£\(trimmed)")
    }

    private func save() async {
        guard let pence = parsedPence else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await state.createLimit(
                query: query.trimmingCharacters(in: .whitespacesAndNewlines),
                maxPence: pence
            )
            Haptics.success()
            dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
