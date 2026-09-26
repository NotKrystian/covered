// Pence in, "£12.34" out. Mirrors src/lib/money.ts. Integer pence everywhere.
import Foundation

enum Money {
    private static let grouping: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = ","
        f.usesGroupingSeparator = true
        return f
    }()

    static func format(_ pence: Int) -> String {
        let negative = pence < 0
        let magnitude = abs(pence)
        let pounds = grouping.string(from: NSNumber(value: magnitude / 100)) ?? String(magnitude / 100)
        return "\(negative ? "−" : "")£\(pounds).\(String(format: "%02d", magnitude % 100))"
    }

    /// "36", "36.5", "£36.50" → 3650. Nil when it does not parse or is negative.
    static func parsePounds(_ text: String) -> Int? {
        let cleaned = text
            .replacingOccurrences(of: "£", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, let value = Decimal(string: cleaned), value >= 0 else { return nil }
        let pence = NSDecimalNumber(decimal: value * 100).rounding(accordingToBehavior: nil)
        return pence.intValue
    }

    /// Whole pounds when exact, otherwise two decimals. For prefilled fields.
    static func poundsText(_ pence: Int) -> String {
        pence % 100 == 0 ? String(pence / 100) : String(format: "%.2f", Double(pence) / 100)
    }
}

enum Dates {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func parse(_ text: String) -> Date? {
        iso.date(from: text) ?? isoPlain.date(from: text)
    }

    /// "26 Sep 2026, 14:22" in en-GB.
    static func short(_ text: String) -> String {
        guard let date = parse(text) else { return text }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "dd MMM yyyy, HH:mm"
        return f.string(from: date)
    }

    static func day(_ text: String) -> String {
        guard let date = parse(text) else { return String(text.prefix(10)) }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "dd MMM yyyy"
        return f.string(from: date)
    }
}
