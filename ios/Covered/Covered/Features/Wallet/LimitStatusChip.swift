import Foundation

/// Visible status chip for a watch-and-buy limit.
/// `last_result` mentioning "short" wins over the stored status so a watching
/// row that just failed the wallet check reads as Wallet short.
enum LimitStatusChip: String, Equatable, Sendable {
    case watching = "Watching"
    case filled = "Filled"
    case paused = "Paused"
    case walletShort = "Wallet short"

    static func resolve(status: LimitStatus, lastResult: String) -> LimitStatusChip {
        resolve(statusRaw: status.rawValue, lastResult: lastResult)
    }

    static func resolve(statusRaw: String, lastResult: String) -> LimitStatusChip {
        if lastResult.localizedCaseInsensitiveContains("short") {
            return .walletShort
        }
        switch statusRaw {
        case LimitStatus.filled.rawValue:
            return .filled
        case LimitStatus.paused.rawValue:
            return .paused
        case LimitStatus.watching.rawValue:
            return .watching
        default:
            return .watching
        }
    }

    /// Relative "last checked 12 min ago" from an ISO-8601 `last_checked_at`.
    static func lastCheckedLabel(_ iso: String, now: Date = Date()) -> String {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Not checked yet" }
        guard let date = Self.parseISO(trimmed) else { return "last checked recently" }
        let seconds = now.timeIntervalSince(date)
        if seconds < 45 { return "last checked just now" }
        if seconds < 3600 {
            let mins = max(1, Int((seconds / 60).rounded()))
            return "last checked \(mins) min ago"
        }
        if seconds < 86_400 {
            let hours = max(1, Int((seconds / 3600).rounded()))
            return "last checked \(hours) hr ago"
        }
        let days = max(1, Int((seconds / 86_400).rounded()))
        return "last checked \(days) day\(days == 1 ? "" : "s") ago"
    }

    static func parseISO(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }

    static func depositDateLabel(_ iso: String) -> String {
        guard let date = parseISO(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en-GB")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
