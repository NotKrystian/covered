import Foundation
import Observation

@MainActor
@Observable
final class OrdersStore {
    var orders: [Order] = []
    var totalPence: Int = 0
    var count: Int = 0
    var isLoading = false
    var errorMessage: String?

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
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func order(id: String) -> Order? {
        orders.first { $0.id == id }
    }

    func assist(orderId: String, message: String, history: [AssistHistoryTurn]) async throws -> AssistResponse {
        try await api.assist(orderId: orderId, message: message, history: history)
    }
}
