// Debug settings: server base URL, Reset memory (DELETE /api/memory), the
// extension note, and the build version.
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var baseURL = ""
    @State private var confirmReset = false
    @State private var resetting = false
    @State private var note: String?

    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(short) (\(build))"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandMark().padding(.top, 12)
                Text("Settings").headline(30)

                section("Server") {
                    Text("Every judgement, wallet debit and memory write happens on the server. The phone only calls it.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                    TextField("https://covered.kawuc.uk", text: $baseURL)
                        .font(.system(size: 15, design: .monospaced))
                        .foregroundStyle(Theme.foreground)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panelRaised).overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.line)))
                    HStack(spacing: 8) {
                        Button("Live") { baseURL = CoveredAPI.defaultBase }.buttonStyle(QuietButtonStyle())
                        Button("localhost:3000") { baseURL = CoveredAPI.localBase }.buttonStyle(QuietButtonStyle())
                        Spacer()
                        Button("Apply") {
                            app.baseURLString = baseURL
                            baseURL = app.baseURLString
                            note = "Using \(app.baseURLString)"
                            Task { await app.bootstrap() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(baseURL.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    Text("Memory store: \(app.store.isEmpty ? "unknown" : app.store)")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }

                section("Memory") {
                    if let memory = app.memory {
                        Text(memory.summary.isEmpty ? "Nothing learned yet. Approve a pick and Covered writes a summary of how you buy." : memory.summary)
                            .font(.system(size: 13))
                            .lineSpacing(3)
                            .foregroundStyle(memory.summary.isEmpty ? Theme.muted : Theme.foreground)
                        Text("\(memory.events.count) event\(memory.events.count == 1 ? "" : "s") · \(memory.orders.count) order\(memory.orders.count == 1 ? "" : "s")")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.muted)
                    }
                    Button(role: .destructive) { confirmReset = true } label: {
                        Text(resetting ? "Resetting…" : "Reset memory")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.danger)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.danger.opacity(0.5)))
                    }
                    .buttonStyle(.plain)
                    .disabled(resetting)
                    Text("Deletes the memory item, wallet, orders and limits for this phone's anonymous id, then starts onboarding again.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }

                section("Live grid") {
                    Text("The real Google Shopping shelf is read by the Covered reader extension in your desktop browser (Brave, Chrome or Firefox), on your own Google session. The phone cannot run it, so searches here use the server read, which usually falls back to an exact-slug snapshot, or the fleece fixtures. Install the reader from the web app at /ext.")
                        .font(.system(size: 13))
                        .lineSpacing(3)
                        .foregroundStyle(Theme.muted)
                }

                if let note {
                    Text(note).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }

                Text("Covered for iOS \(version)")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 20)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .background(Theme.background)
        .onAppear { baseURL = app.baseURLString }
        .confirmationDialog("Reset memory?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset memory", role: .destructive) {
                resetting = true
                Task {
                    do {
                        try await app.resetMemory()
                        note = "Memory reset. New anonymous id."
                    } catch {
                        note = (error as? APIError)?.message ?? error.localizedDescription
                    }
                    resetting = false
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This forgets everything Covered learned about how you buy, and the demo wallet with it.")
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.foreground)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .panelCard()
    }
}
