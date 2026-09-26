import Foundation

/// 14-day cooling-off as the server reports it (`ends_at` + `blocked`).
struct ReturnWindow: Equatable, Sendable {
    static let coolingOffDays = 14

    var daysRemaining: Int
    var isOpen: Bool
    var blocked: String?
    var endsAt: Date?

    var progress: Double {
        guard Self.coolingOffDays > 0 else { return 0 }
        return min(1, max(0, Double(daysRemaining) / Double(Self.coolingOffDays)))
    }

    var headline: String {
        if let blocked, !blocked.isEmpty {
            return blocked
        }
        if !isOpen {
            return "Return window closed"
        }
        if daysRemaining == 1 {
            return "1 day left to change your mind"
        }
        return "\(daysRemaining) days left to change your mind"
    }

    var daysLabel: String {
        "\(max(0, daysRemaining))"
    }

    var footnote: String {
        if let blocked, !blocked.isEmpty { return blocked }
        if let endsAt {
            return "Window closes \(OrderDate.listLabel(ISO8601DateFormatter().string(from: endsAt)))"
        }
        return "14-day cooling-off from the server."
    }

    static func from(endsAt: String?, blocked: String?, now: Date = Date()) -> ReturnWindow {
        let end = endsAt.flatMap(OrderDate.parse)
        let remaining: Int
        if let end {
            remaining = max(0, Int(ceil(end.timeIntervalSince(now) / 86_400)))
        } else {
            remaining = 0
        }
        let blockedText = (blocked?.isEmpty == false) ? blocked : nil
        let open = blockedText == nil && remaining > 0
        return ReturnWindow(
            daysRemaining: remaining,
            isOpen: open,
            blocked: blockedText,
            endsAt: end
        )
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

extension Order {
    func returnWindow(watch: SwitchWatch?, now: Date = Date()) -> ReturnWindow {
        ReturnWindow.from(endsAt: watch?.endsAt, blocked: watch?.blocked, now: now)
    }

    var rightsChipText: String {
        if cancelledAt != nil {
            return "return started · \(formatGBP(refundPence ?? pricePence)) refund pending"
        }
        return "Rights kept · 14-day cancellation · 30-day fault refund"
    }

    func paidMeta(watch: SwitchWatch?) -> String {
        if cancelledAt != nil {
            return "return started · \(formatGBP(refundPence ?? pricePence)) refund pending"
        }
        if let watch, let remaining = Optional(ReturnWindow.from(endsAt: watch.endsAt, blocked: watch.blocked)),
           remaining.isOpen {
            return "Paid · \(merchant)"
        }
        return "Paid · \(merchant)"
    }
}
