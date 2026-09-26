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
