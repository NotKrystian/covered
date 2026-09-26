import SwiftUI

struct SettingsView: View {
    private let state = AppState.shared

    @State private var displayName = ""
    @State private var premiumPounds = 10
    @State private var switchPounds = 8
    @State private var baseURL = UserDefaults.standard.string(forKey: APIClient.baseURLDefaultsKey)
        ?? APIClient.defaultBaseURL.absoluteString
    @State private var saveError: String?
    @State private var saveNote: String?
    @State private var saving = false
    @State private var confirmReset = false
    @State private var resetting = false

    var body: some View {
        NavigationStack {
            List {
                identitySection
                rightsSection
                pairingSection
                memorySection
                resetSection
                serverSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.canvas.ignoresSafeArea())
            .navigationTitle("Settings")
            .toolbarBackground(Color.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .font(.ui(16, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .disabled(saving)
                }
            }
            .confirmationDialog(
                "Reset memory?",
                isPresented: $confirmReset,
                titleVisibility: .visible
            ) {
                Button("Reset memory") {
                    Task { await resetMemory() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This forgets how you buy and clears the demo wallet on this phone.")
            }
            .task { await load() }
        }
        .tint(Color.accent)
    }

    private var identitySection: some View {
        Section {
            TextField("Name", text: $displayName)
                .font(.ui(16))
                .textInputAutocapitalization(.words)
                .listRowBackground(Color.white.opacity(0.72))
        } header: {
            Text("Name")
                .textCase(nil)
        }
    }

    private var rightsSection: some View {
        Section {
            Stepper(value: $premiumPounds, in: 0...50) {
                Text("Pay up to £\(premiumPounds) more for UK buyer rights")
                    .font(.ui(15))
                    .foregroundStyle(Color.ink)
                    .monospacedDigit()
            }
            .listRowBackground(Color.white.opacity(0.72))

            Stepper(value: $switchPounds, in: 0...50) {
                Text("Only switch inside 14 days if I clear £\(switchPounds) after postage")
                    .font(.ui(15))
                    .foregroundStyle(Color.ink)
                    .monospacedDigit()
            }
            .listRowBackground(Color.white.opacity(0.72))

            if let saveError {
                Text(saveError)
                    .font(.ui(13))
                    .foregroundStyle(Color.dangerGrey)
                    .listRowBackground(Color.clear)
                    .coveredSwap()
            } else if let saveNote {
                Text(saveNote)
                    .font(.ui(13))
                    .foregroundStyle(Color.muted)
                    .listRowBackground(Color.clear)
                    .coveredSwap()
            }
        } header: {
            Text("Rights")
                .textCase(nil)
        }
    }

    private var pairingSection: some View {
        Section {
            NavigationLink {
                PairingView()
            } label: {
                Text("Pair with your laptop")
                    .font(.ui(16))
                    .foregroundStyle(Color.ink)
            }
            .listRowBackground(Color.white.opacity(0.72))
        }
    }

    private var memorySection: some View {
        Section {
            if let summary = state.memory?.summary?.trimmingCharacters(in: .whitespacesAndNewlines),
               !summary.isEmpty {
                Text(summary)
                    .font(.ui(14))
                    .foregroundStyle(Color.ink)
                    .listRowBackground(Color.white.opacity(0.72))
            } else {
                Text("Nothing learned yet.")
                    .font(.ui(14))
                    .foregroundStyle(Color.muted)
                    .listRowBackground(Color.white.opacity(0.72))
            }
        } header: {
            Text("Memory")
                .textCase(nil)
        }
    }

    private var resetSection: some View {
        Section {
            Button("Reset memory") {
                confirmReset = true
            }
            .font(.ui(16, weight: .semibold))
            .foregroundStyle(Color.ink)
            .disabled(resetting)
            .listRowBackground(Color.white.opacity(0.72))
        } footer: {
            Text("Clears preference memory on the server. Approve events are how Covered learns; this wipes that.")
        }
    }

    private var serverSection: some View {
        Section {
            TextField("https://covered.kawuc.uk", text: $baseURL)
                .font(.ui(13))
                .foregroundStyle(Color.muted)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .accessibilityIdentifier("settings.baseURL")
                .onChange(of: baseURL) { _, next in
                    persistBaseURL(next)
                }
                .listRowBackground(Color.white.opacity(0.55))
        } header: {
            Text("Server")
                .font(.ui(12, weight: .semibold))
                .foregroundStyle(Color.muted)
                .textCase(nil)
        } footer: {
            Text("Default is https://covered.kawuc.uk. Use http://localhost:3000 for a local Next server.")
                .font(.ui(11))
        }
    }

    private func load() async {
        if state.memory == nil {
            await state.refresh()
        }
        displayName = state.memory?.displayName ?? ""
        let settings = state.memory?.settings ?? state.settings
        premiumPounds = max(0, settings.protectionPremiumPence / 100)
        switchPounds = max(0, settings.switchMinimumPence / 100)
        if let stored = UserDefaults.standard.string(forKey: APIClient.baseURLDefaultsKey), !stored.isEmpty {
            baseURL = stored
        }
    }

    private func save() async {
        saving = true
        saveError = nil
        saveNote = nil
        defer { saving = false }
        persistBaseURL(baseURL)
        let next = UserSettings(
            protectionPremiumPence: premiumPounds * 100,
            switchMinimumPence: switchPounds * 100,
            approval: state.settings.approval
        )
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await state.saveSettings(
                displayName: name.isEmpty ? nil : name,
                settings: next
            )
            Haptics.success()
            saveNote = "Saved."
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func resetMemory() async {
        resetting = true
        defer { resetting = false }
        do {
            try await state.resetMemory()
            displayName = ""
            premiumPounds = UserSettings.defaults.protectionPremiumPence / 100
            switchPounds = UserSettings.defaults.switchMinimumPence / 100
            saveError = nil
            saveNote = nil
            Haptics.success()
        } catch {
            saveError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func persistBaseURL(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            UserDefaults.standard.set(
                APIClient.defaultBaseURL.absoluteString,
                forKey: APIClient.baseURLDefaultsKey
            )
        } else {
            UserDefaults.standard.set(trimmed, forKey: APIClient.baseURLDefaultsKey)
        }
    }
}
