import Foundation
import Observation

/// Shared tab selection so Shop can jump to Orders or Wallet after Approve.
@MainActor
@Observable
final class CoveredTabs {
    static let shared = CoveredTabs()

    enum Tab: Hashable, Sendable {
        case shop
        case orders
        case wallet
        case settings
    }

    var selection: Tab = .shop

    func open(_ tab: Tab) {
        selection = tab
    }
}
