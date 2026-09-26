import Foundation

/// 14-day cooling-off, counted on the device from the order date `t`.
/// We do not have a delivery date, so this is an estimate — say so in the UI.
struct ReturnWindow: Equatable, Sendable {
    static let coolingOffDays = 14

    var daysElapsed: Int
    var daysRemaining: Int
    var isOpen: Bool

    var progress: Double {
        guard Self.coolingOffDays > 0 else { return 0 }
        return min(1, max(0, Double(daysRemaining) / Double(Self.coolingOffDays)))
    }

    var headline: String {
        if !isOpen {
            return "Return window closed"
        }
        if daysRemaining == 1 {
            return "1 day left to change your mind"
        }
        return "\(daysRemaining) days left to change your mind"
    }

    var footnote: String {
        "Counts from the order date because we don't have a delivery date."
    }

    static func compute(orderDate: Date, now: Date = Date()) -> ReturnWindow {
        let elapsed = max(0, Int(floor(now.timeIntervalSince(orderDate) / 86_400)))
        let remaining = Self.coolingOffDays - elapsed
        return ReturnWindow(
            daysElapsed: elapsed,
            daysRemaining: max(0, remaining),
            isOpen: elapsed <= Self.coolingOffDays
        )
    }

    static func compute(iso: String, now: Date = Date()) -> ReturnWindow {
        guard let date = OrderDate.parse(iso) else {
            return ReturnWindow(daysElapsed: 0, daysRemaining: Self.coolingOffDays, isOpen: true)
        }
        return compute(orderDate: date, now: now)
    }
}

enum OrderDate {
    static func parse(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: iso) { return date }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(iso.prefix(10)))
    }

    static func listLabel(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en-GB")
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }
}

enum PrivateSellerHint {
    private static let tokens = [
        "facebook", "marketplace", "gumtree", "vinted", "depop",
        "private seller", "private", "collection only",
    ]

    static func matches(_ merchant: String) -> Bool {
        let lower = merchant.lowercased()
        return tokens.contains { lower.contains($0) }
    }
}

extension ReceiptSection {
    func englishLabel(merchant: String) -> String {
        switch self {
        case .sponsored:
            return "ad"
        case .browse, .fixture:
            return PrivateSellerHint.matches(merchant) ? "private seller" : "UK shop"
        }
    }
}

extension Order {
    func returnWindow(now: Date = Date()) -> ReturnWindow {
        ReturnWindow.compute(iso: t, now: now)
    }

    var sectionLabel: String {
        section.englishLabel(merchant: merchant)
    }
}
