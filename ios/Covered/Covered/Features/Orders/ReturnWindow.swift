import Foundation

/// 14-day cooling-off from the server's exclusive `ends_at` midnight, counted
/// in UK calendar days (`Europe/London`). The last valid day is the calendar
/// day before that midnight. On the order day this reads 14; on the last day, 1.
struct ReturnWindow: Equatable, Sendable {
    static let coolingOffDays = 14
    static let london = TimeZone(identifier: "Europe/London") ?? TimeZone(secondsFromGMT: 0)!

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
            return "window closed"
        }
        if daysRemaining == 1 {
            return "last day"
        }
        return "\(daysRemaining) days left"
    }

    var daysLabel: String {
        "\(max(0, daysRemaining))"
    }

    var footnote: String {
        if let blocked, !blocked.isEmpty { return blocked }
        if !isOpen { return "window closed" }
        if daysRemaining == 1 { return "last day" }
        return "\(daysRemaining) days left"
    }

    static func ukCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = london
        return calendar
    }

    /// Exclusive `ends_at` midnight → last valid UK calendar day is the day before.
    static func lastValidDay(endsAt: Date) -> Date {
        let calendar = ukCalendar()
        let start = calendar.startOfDay(for: endsAt)
        return calendar.date(byAdding: .day, value: -1, to: start) ?? start
    }

    /// Server rule: exclusive UK midnight after the 14th calendar day from the order date.
    static func endsAt(fromOrderDate orderDate: Date) -> Date {
        let calendar = ukCalendar()
        let start = calendar.startOfDay(for: orderDate)
        return calendar.date(byAdding: .day, value: coolingOffDays + 1, to: start) ?? start
    }

    static func from(endsAt: String?, blocked: String?, now: Date = Date()) -> ReturnWindow {
        let end = endsAt.flatMap(OrderDate.parse)
        return from(ends: end, blocked: blocked, now: now)
    }

    static func fromOrderDate(iso: String, blocked: String?, now: Date = Date()) -> ReturnWindow {
        let placed = OrderDate.parse(iso)
        let end = placed.map(endsAt(fromOrderDate:))
        return from(ends: end, blocked: blocked, now: now)
    }

    static func from(ends: Date?, blocked: String?, now: Date = Date()) -> ReturnWindow {
        let blockedText = (blocked?.isEmpty == false) ? blocked : nil
        guard let ends else {
            return ReturnWindow(daysRemaining: 0, isOpen: false, blocked: blockedText, endsAt: nil)
        }
        if now >= ends || blockedText != nil {
            return ReturnWindow(
                daysRemaining: 0,
                isOpen: blockedText == nil ? false : false,
                blocked: blockedText,
                endsAt: ends
            )
        }
        let lastValid = lastValidDay(endsAt: ends)
        let calendar = ukCalendar()
        let today = calendar.startOfDay(for: now)
        let last = calendar.startOfDay(for: lastValid)
        let delta = calendar.dateComponents([.day], from: today, to: last).day ?? 0
        let remaining: Int
        if delta < 0 {
            remaining = 0
        } else if delta == 0 {
            remaining = 1
        } else {
            remaining = delta
        }
        return ReturnWindow(
            daysRemaining: remaining,
            isOpen: remaining > 0 && blockedText == nil,
            blocked: blockedText,
            endsAt: ends
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
        day.timeZone = ReturnWindow.london
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: String(iso.prefix(10)))
    }

    static func listLabel(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en-GB")
        formatter.timeZone = ReturnWindow.london
        formatter.dateFormat = "d MMM yyyy"
        return formatter.string(from: date)
    }
}

extension Order {
    func returnWindow(watch: SwitchWatch?, now: Date = Date()) -> ReturnWindow {
        if let ends = watch?.endsAt, !ends.isEmpty {
            return ReturnWindow.from(endsAt: ends, blocked: watch?.blocked, now: now)
        }
        return ReturnWindow.fromOrderDate(iso: t, blocked: watch?.blocked, now: now)
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
        return "Paid · \(merchant)"
    }
}
