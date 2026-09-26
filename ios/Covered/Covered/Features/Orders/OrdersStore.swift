import Foundation
import Observation

@MainActor
@Observable
final class OrdersStore {
    var orders: [Order] = []
    var watches: [SwitchWatch] = []
    var totalPence: Int = 0
    var count: Int = 0
    var isLoading = false
    var errorMessage: String?
    var switchAuthBlocked = false

    private let api: APIClient

    init(api: APIClient? = nil) {
        self.api = api ?? AppState.shared.api
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response: OrdersResponse = try await api.send("GET", "/api/orders")
            orders = response.orders
            totalPence = response.totalPence ?? response.orders.reduce(0) { $0 + $1.pricePence }
            count = response.count ?? response.orders.count
            errorMessage = nil
            AppState.shared.orders = response.orders
            await refreshWatches()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func refreshWatches() async {
        do {
            watches = try await api.switchWatches()
            switchAuthBlocked = false
        } catch let error as APIError {
            if case .http(let status, _) = error, status == 401 {
                switchAuthBlocked = true
                watches = []
            }
        } catch {
            watches = []
        }
    }

    func watch(for order: Order) -> SwitchWatch? {
        watches.first(where: { $0.order.id == order.id })
    }

    func order(id: String) -> Order? {
        if let updated = watches.first(where: { $0.order.id == id })?.order {
            return updated
        }
        return orders.first { $0.id == id }
    }

    func assist(orderId: String, message: String, history: [AssistHistoryTurn]) async throws -> AssistResponse {
        try await api.assist(orderId: orderId, message: message, history: history)
    }

    func checkSwitch(order: Order) async throws -> SwitchRunResponse {
        let result = try await api.search(query: order.query)
        return try await api.runSwitch(orderId: order.id, offers: result.offers)
    }

    func simulateSwitch(orderId: String) async throws -> SwitchRunResponse {
        try await api.simulateSwitch(orderId: orderId)
    }

    func acceptSwitch(orderId: String) async throws -> SwitchAcceptResponse {
        try await api.acceptSwitch(orderId: orderId)
    }
}
