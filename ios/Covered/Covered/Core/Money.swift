import Foundation

typealias Pence = Int

/// Format integer pence as `"£1,099.00"`. Negative values keep the sign: `"-£3.50"`.
func formatGBP(_ pence: Int) -> String {
    let sign = pence < 0 ? "-" : ""
    let absolute = abs(Int((Double(pence)).rounded()))
    let pounds = absolute / 100
    let rem = absolute % 100
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en-GB")
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    formatter.groupingSeparator = ","
    formatter.usesGroupingSeparator = true
    let poundsText = formatter.string(from: NSNumber(value: pounds)) ?? "\(pounds)"
    return "\(sign)£\(poundsText).\(String(format: "%02d", rem))"
}

/// Monthly tariff as `"£30/mo"` (drop trailing .00).
func formatMonthlyGBP(_ pence: Int) -> String {
    if pence % 100 == 0 {
        let formatted = formatGBP(pence)
        let trimmed = formatted.hasSuffix(".00") ? String(formatted.dropLast(3)) : formatted
        return "\(trimmed)/mo"
    }
    return "\(formatGBP(pence))/mo"
}

func isMonthlyOnly(_ item: ShortlistItem) -> Bool {
    if item.priceKind == .monthly { return true }
    if item.priceKind == .cash { return false }
    return item.pricePence == nil && item.monthlyPence != nil
}

func listingPriceLabel(_ item: ShortlistItem) -> String {
    if isMonthlyOnly(item), let monthly = item.monthlyPence {
        return formatMonthlyGBP(monthly)
    }
    return item.priceLabel
}

func listingMonthlyNote(_ item: ShortlistItem) -> String? {
    var bits: [String] = []
    if item.priceKind == .cash, let monthly = item.monthlyPence, item.pricePence != nil {
        bits.append("or \(formatMonthlyGBP(monthly))")
    }
    if let term = item.termMonths {
        bits.append("\(term) months")
    }
    if let upfront = item.upfrontPence {
        bits.append("\(formatGBP(upfront)) upfront")
    }
    return bits.isEmpty ? nil : bits.joined(separator: " · ")
}

/// Parse a displayed price like `"£249.00"`, `"£1,249"`, `"249.00"`, or `"£8.50"` into pence.
/// Returns nil when there is no single parseable amount (e.g. `"£20 – £30"`, `"Free"`, `""`).
func parsePricePence(_ input: String) -> Int? {
    var cleaned = input
        .replacingOccurrences(of: "£", with: "")
        .replacingOccurrences(of: ",", with: "")
        .replacingOccurrences(of: " ", with: "")
        .replacingOccurrences(of: "\u{00a0}", with: "")
    if cleaned.lowercased().hasPrefix("gbp") {
        cleaned = String(cleaned.dropFirst(3))
    }
    if cleaned.contains("-") || cleaned.contains("–") || cleaned.contains("−") {
        return nil
    }
    let numberRegex = try? NSRegularExpression(pattern: #"\d+(?:\.\d+)?"#)
    let full = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
    let count = numberRegex?.numberOfMatches(in: cleaned, range: full) ?? 0
    if count != 1 { return nil }
    let exact = try? NSRegularExpression(pattern: #"^(\d+)(?:\.(\d{1,2}))?$"#)
    guard let match = exact?.firstMatch(in: cleaned, range: full),
          let poundsRange = Range(match.range(at: 1), in: cleaned)
    else { return nil }
    let pounds = Int(cleaned[poundsRange]) ?? 0
    let penceStr: String
    if match.range(at: 2).location != NSNotFound, let penceRange = Range(match.range(at: 2), in: cleaned) {
        penceStr = cleaned[penceRange].padding(toLength: 2, withPad: "0", startingAt: 0)
    } else {
        penceStr = "00"
    }
    guard let pence = Int(penceStr) else { return nil }
    return pounds * 100 + pence
}
