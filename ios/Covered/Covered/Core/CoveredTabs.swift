import Foundation
import Observation

/// Shared tab selection so Shop can jump to Orders or Wallet after Approve.
@MainActor
@Observable
final class CoveredTabs {
    static let shared = CoveredTabs()

    enum Tab: String, Hashable, Sendable, CaseIterable, Identifiable {
        case shop
        case orders
        case wallet
        case settings

        var id: String { rawValue }

        var title: String {
            switch self {
            case .shop: return "Shop"
            case .orders: return "Orders"
            case .wallet: return "Wallet"
            case .settings: return "Settings"
            }
        }

        var identifier: String {
            switch self {
            case .shop: return "tabs.shop"
            case .orders: return "tabs.orders"
            case .wallet: return "tabs.wallet"
            case .settings: return "tabs.settings"
            }
        }
    }

    var selection: Tab = .shop

    func open(_ tab: Tab) {
        selection = tab
    }
}
