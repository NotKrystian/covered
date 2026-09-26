import Foundation

enum AftercarePresentation {
    /// One-line outcome under each bot turn. Copy is fixed for the iPhone, not the web phrasing.
    static func outcomeLine(_ response: AssistResponse) -> String {
        if response.refused {
            return "Refused: that's a change of mind"
        }
        switch response.remedy {
        case .refund:
            if response.right.contains("30") {
                return "Refund under the 30-day right"
            }
            if response.right.range(of: "14|cooling", options: [.regularExpression, .caseInsensitive]) != nil {
                return "14-day cooling-off return"
            }
            return "14-day cooling-off return"
        case .replace, .repair:
            return "Repair or replacement first (after 30 days)"
        case .none:
            return response.right
        }
    }

    static func remedyLabel(_ remedy: AftercareRemedy) -> String {
        switch remedy {
        case .refund:
            return "Refund"
        case .replace:
            return "Replacement"
        case .repair:
            return "Repair"
        case .none:
            return "No remedy"
        }
    }
}

struct AftercareTurn: Identifiable, Equatable, Sendable {
    enum Role: String, Equatable, Sendable {
        case user
        case assistant
    }

    var id: String
    var role: Role
    var text: String
    var outcome: String?
    var draftToSeller: String?
    var refused: Bool

    var historyPayload: AssistHistoryTurn {
        AssistHistoryTurn(role: role.rawValue, text: text)
    }
}
