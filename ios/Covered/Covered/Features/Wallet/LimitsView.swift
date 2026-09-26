import SwiftUI

struct LimitsView: View {
    private let state = AppState.shared
    @State private var limitError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Your laptop's Covered reader checks each limit every hour and buys only if it's the real item, keeps your rights, is at or under your price, and the wallet covers it.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                    if let limitError {
                        Text(limitError)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.secondary)
                    }
                    if state.limits.isEmpty {
                        Text("No limits yet.")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.secondary)
                    } else {
                        ForEach(state.limits) { limit in
                            LimitRowView(limit: limit)
                        }
                    }
                    NavigationLink {
                        NewLimitView()
                    } label: {
                        Text("New limit")
                            .font(.system(size: 18.5, weight: .semibold))
                            .foregroundStyle(Color.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: Theme.approveHeight)
                            .background(Color.ink, in: Capsule())
                    }
                }
                .padding(Theme.inset)
            }
            .background(Color.screen.ignoresSafeArea())
            .navigationTitle("Limits")
            .refreshable { await state.refresh() }
            .task { await state.refresh() }
        }
        .tint(Color.ink)
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
        VStack(alignment: .leading, spacing: 16) {
            TextField("What to watch", text: $query)
                .font(.system(size: 15.5))
                .padding(.horizontal, 20)
                .frame(height: Theme.composerHeight)
                .background(Color.composer, in: Capsule())
            HStack {
                Text("£")
                    .filmMoney(17, weight: .medium)
                TextField("Max price", text: $poundsText)
                    .keyboardType(.decimalPad)
                    .filmMoney(17, weight: .medium)
            }
            .padding(.horizontal, 20)
            .frame(height: Theme.composerHeight)
            .background(Color.composer, in: Capsule())
            if let error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.secondary)
            }
            InkPillButton(title: saving ? "Saving…" : "Watch and buy", enabled: !saving && canSave) {
                Task { await save() }
            }
            Spacer()
        }
        .padding(Theme.inset)
        .background(Color.screen.ignoresSafeArea())
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
