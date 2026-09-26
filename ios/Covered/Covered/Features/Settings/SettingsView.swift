import SwiftUI

struct SettingsView: View {
    private let state = AppState.shared

    @State private var displayName = ""
    @State private var premiumBps = UserSettings.defaults.protectionPremiumBps
    @State private var switchPence = UserSettings.defaults.switchMinimumPence
    @State private var baseURL = UserDefaults.standard.string(forKey: APIClient.baseURLDefaultsKey)
        ?? APIClient.defaultBaseURL.absoluteString
    @State private var saveError: String?
    @State private var saveNote: String?
    @State private var saving = false
    @State private var confirmReset = false
    @State private var resetting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    FilmHeader()
                        .padding(.horizontal, -Theme.inset)

                    field("Name") {
                        TextField("Name", text: $displayName)
                            .font(.system(size: 14.5))
                            .textInputAutocapitalization(.words)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Rights")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.secondary)
                        PremiumControl(
                            value: $premiumBps,
                            unit: .percentBps,
                            shopWins: true,
                            verdictLead: "Pay up to \(formatPercentBps(premiumBps))",
                            verdictBody: "Share of the UK shop price you will pay extra for buyer rights."
                        )
                        PremiumControl(
                            value: $switchPence,
                            unit: .pence,
                            shopWins: true,
                            verdictLead: "Switch floor \(formatGBP(switchPence))",
                            verdictBody: "Only switch inside 14 days if I still clear this after postage."
                        )
                    }

                    NavigationLink {
                        PairingView()
                    } label: {
                        Text("Pair with your laptop")
                            .font(.system(size: 14.5))
                            .foregroundStyle(Color.inkSoft)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 12)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Remembered")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.secondary)
                        if let summary = state.memory?.summary?.trimmingCharacters(in: .whitespacesAndNewlines),
                           !summary.isEmpty {
                            HStack(spacing: 8) {
                                Circle().fill(Color.accent).frame(width: 6.5, height: 6.5)
                                Text(summary)
                                    .font(.system(size: 15.5, weight: .medium))
                                    .foregroundStyle(Color.inkSoft)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 38.5)
                            .background(Color.panel, in: Capsule())
                        } else {
                            Text("Nothing learned yet.")
                                .font(.system(size: 14.5))
                                .foregroundStyle(Color.secondary)
                        }
                    }

                    Button("Reset memory") { confirmReset = true }
                        .font(.system(size: 14.5, weight: .medium))
                        .foregroundStyle(Color.inkSoft)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .overlay(Capsule().strokeBorder(Color.ink, lineWidth: 1))
                        .disabled(resetting)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Server")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.secondary)
                        TextField("https://covered.kawuc.uk", text: $baseURL)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.tertiary)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .accessibilityIdentifier("settings.baseURL")
                            .onChange(of: baseURL) { _, next in persistBaseURL(next) }
                    }

                    if let saveError {
                        Text(saveError).font(.system(size: 13)).foregroundStyle(Color.secondary)
                    } else if let saveNote {
                        Text(saveNote).font(.system(size: 13)).foregroundStyle(Color.secondary)
                    }

                    InkPillButton(title: saving ? "Saving…" : "Save", enabled: !saving) {
                        Task { await save() }
                    }
                }
                .padding(.horizontal, Theme.inset)
                .padding(.bottom, 24)
            }
            .background(Color.screen.ignoresSafeArea())
            .navigationBarHidden(true)
            .confirmationDialog(
                "Reset memory?",
                isPresented: $confirmReset,
                titleVisibility: .visible
            ) {
                Button("Reset memory") { Task { await resetMemory() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This forgets how you buy and clears the demo wallet on this phone.")
            }
            .task { await load() }
        }
        .tint(Color.ink)
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.secondary)
            content()
                .padding(.vertical, 10)
            Rectangle().fill(Color.divider).frame(height: 1)
        }
    }

    private func load() async {
        if state.memory == nil {
            await state.refresh()
        }
        displayName = state.memory?.displayName ?? ""
        let settings = state.memory?.settings ?? state.settings
        premiumBps = settings.protectionPremiumBps
        switchPence = settings.switchMinimumPence
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
            protectionPremiumBps: premiumBps,
            protectionPremiumPence: 0,
            switchMinimumPence: switchPence,
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
            premiumBps = UserSettings.defaults.protectionPremiumBps
            switchPence = UserSettings.defaults.switchMinimumPence
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
