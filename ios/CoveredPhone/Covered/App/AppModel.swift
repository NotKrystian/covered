// App-wide state: the buyer's memory item (settings, wallet, name) as the
// server holds it. Nothing here judges, debits or remembers on the phone.
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case loading
        case failed(String)
        case onboarding
        case ready
    }

    var phase: Phase = .loading
    var memory: Memory?
    var balancePence = 0
    var settings: UserSettings = .defaults
    var store = ""

    let api = CoveredAPI.shared

    var displayName: String {
        memory?.displayName?.trimmingCharacters(in: .whitespaces) ?? ""
    }

    var greeting: String {
        displayName.isEmpty ? "Hello" : "Hello, \(displayName)"
    }

    var baseURLString: String {
        get { api.baseURLString }
        set { api.baseURLString = newValue }
    }

    func bootstrap() async {
        phase = .loading
        do {
            var response = try await api.memory()
            if !response.memory.onboarded, let name = LaunchFlags.demoOnboardedName {
                response = try await api.patchMemory(.init(displayName: name, settings: nil, onboarded: true))
            }
            apply(response.memory, store: response.store)
            phase = response.memory.onboarded ? .ready : .onboarding
        } catch let error as APIError {
            phase = .failed(error.message)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func apply(_ next: Memory, store: String? = nil) {
        memory = next
        balancePence = next.balancePence
        settings = next.settings
        if let store { self.store = store }
    }

    func refreshWallet() async {
        if let wallet = try? await api.wallet() {
            balancePence = wallet.balancePence
        }
    }

    func deposit(pence: Int) async throws {
        let wallet = try await api.deposit(pence: pence)
        balancePence = wallet.balancePence
    }

    /// Onboarding: name + the two pound rules, then an optional deposit.
    func finishOnboarding(name: String, settings: UserSettings, depositPence: Int) async throws {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let saved = try await api.patchMemory(.init(displayName: trimmed.isEmpty ? nil : trimmed, settings: settings, onboarded: true))
        apply(saved.memory, store: saved.store)
        if depositPence > 0 {
            try await deposit(pence: depositPence)
        }
        phase = .ready
    }

    func savePreferences(_ next: UserSettings) async throws {
        let saved = try await api.patchMemory(.init(displayName: nil, settings: next, onboarded: nil))
        apply(saved.memory, store: saved.store)
    }

    /// DELETE /api/memory, then start again as a new buyer.
    func resetMemory() async throws {
        try await api.resetMemory()
        memory = nil
        balancePence = 0
        settings = .defaults
        await bootstrap()
    }
}
