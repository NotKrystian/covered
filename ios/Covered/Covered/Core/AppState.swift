import Foundation
import Observation

@MainActor
@Observable
final class AppState {
    static let shared = AppState()
    static let onboardedDefaultsKey = "covered.onboarded"

    let api: APIClient

    var settings: UserSettings = .defaults
    var wallet: Wallet?
    var orders: [Order] = []
    var limits: [Limit] = []
    var memory: Memory?
    var searchResult: SearchResult?
    var verdict: DecideResponse?
    var lastError: String?
    var isLoading = false

    var onboarded: Bool {
        didSet { UserDefaults.standard.set(onboarded, forKey: Self.onboardedDefaultsKey) }
    }

    init(api: APIClient = APIClient()) {
        self.api = api
        self.onboarded = UserDefaults.standard.bool(forKey: Self.onboardedDefaultsKey)
    }

    func refresh() async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            async let memoryTask = api.memory()
            async let walletTask = api.wallet()
            async let ordersTask = api.orders()
            async let limitsTask = api.limits()
            let loaded = try await memoryTask
            memory = loaded
            settings = loaded.settings
            if loaded.onboarded {
                onboarded = true
            }
            wallet = try await walletTask
            orders = try await ordersTask
            limits = try await limitsTask
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func search(query: String) async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            searchResult = try await api.search(query: query)
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func decide(query: String, source: SearchSource? = nil, offers: [Offer]? = nil) async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            verdict = try await api.decide(
                query: query,
                settings: settings,
                source: source,
                offers: offers ?? searchResult?.offers
            )
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func approve(receipt: Receipt) async throws -> ApproveResponse {
        let response = try await api.approve(receipt: receipt)
        if let balance = response.balancePence {
            wallet = Wallet(balancePence: balance, deposits: wallet?.deposits ?? [])
        }
        await refresh()
        return response
    }

    func deposit(pence: Int) async throws {
        wallet = try await api.deposit(pence: pence)
    }

    func createLimit(query: String, maxPence: Int) async throws {
        limits = try await api.createLimit(query: query, maxPence: maxPence)
    }

    func deleteLimit(id: String) async throws {
        limits = try await api.deleteLimit(id: id)
    }

    func saveSettings(
        displayName: String? = nil,
        settings next: UserSettings? = nil,
        onboarded flag: Bool? = nil
    ) async throws {
        let loaded = try await api.saveSettings(
            displayName: displayName,
            settings: next,
            onboarded: flag
        )
        memory = loaded
        self.settings = loaded.settings
        if flag == true || loaded.onboarded {
            onboarded = true
        }
    }

    func completeOnboarding(displayName: String?, settings: UserSettings, depositPence: Int) async throws {
        try await saveSettings(displayName: displayName, settings: settings, onboarded: true)
        if depositPence > 0 {
            try await deposit(pence: depositPence)
        }
        onboarded = true
    }

    func resetMemory() async throws {
        try await api.resetMemory()
        memory = nil
        wallet = nil
        orders = []
        limits = []
        verdict = nil
        searchResult = nil
        settings = .defaults
        onboarded = false
    }
}
