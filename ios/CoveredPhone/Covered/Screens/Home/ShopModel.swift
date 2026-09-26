// Search state for the Home screen. The phone has no reader extension, so a
// search is POST /api/search (server read or exact-slug snapshot) followed by
// POST /api/decide. The fleece fixtures always work.
import Foundation
import Observation

struct SearchFailure: Equatable {
    enum Kind: Equatable { case challenge, noOffers, other }
    var kind: Kind
    var title: String
    var message: String
}

@MainActor
@Observable
final class ShopModel {
    var query = ""
    var running = false
    var result: DecideResponse?
    var failure: SearchFailure?
    var sort: SortKey = .default
    var receiptLine: String?
    /// The query the current result was judged for.
    var judgedQuery = ""
    var sourceLabel = ""
    /// True while the field is expanded over an existing result.
    var editing = false

    static let fixtureQuery = "black fleece jacket medium"

    let api = CoveredAPI.shared

    var rows: [ShortlistItem] {
        guard let result else { return [] }
        return ListingSort.sort(result.listings, by: sort, decisions: result.decisions,
                                briefBrand: result.briefBrand, chosenId: result.verdict.chosenId)
    }

    var chosenId: String? { result?.verdict.chosenId }
    var chosenItem: ShortlistItem? { result?.chosen }

    var chosenIsProtected: Bool {
        guard let chosenId, let decision = result?.decisions[chosenId] else { return false }
        return decision.isProtected
    }

    var isFixtureQuery: Bool {
        query.lowercased().contains("fleece")
    }

    private func begin() {
        running = true
        failure = nil
        receiptLine = nil
        result = nil
        editing = false
    }

    /// Server grid read, then the judge.
    func search(settings: UserSettings, displayName: String) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !running else { return }
        begin()
        defer { running = false }
        do {
            let read = try await api.search(query: q)
            let judged = try await api.decide(query: q, settings: settings, displayName: displayName.isEmpty ? nil : displayName, read: read)
            result = judged
            judgedQuery = q
            sourceLabel = Self.label(for: read)
        } catch let error as APIError {
            failure = Self.failure(for: error, query: q)
        } catch {
            failure = SearchFailure(kind: .other, title: "Search did not finish", message: error.localizedDescription)
        }
    }

    /// The four seeded listings with photos. `source: "fixture"`.
    func runFixtures(settings: UserSettings, displayName: String) async {
        guard !running else { return }
        if !isFixtureQuery { query = Self.fixtureQuery }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        begin()
        defer { running = false }
        do {
            let judged = try await api.decideFixtures(query: q, settings: settings, displayName: displayName.isEmpty ? nil : displayName)
            result = judged
            judgedQuery = q
            sourceLabel = "fixtures · 4 seeded listings"
        } catch let error as APIError {
            failure = SearchFailure(kind: .other, title: "The judge did not answer", message: error.message)
        } catch {
            failure = SearchFailure(kind: .other, title: "The judge did not answer", message: error.localizedDescription)
        }
    }

    private static func label(for read: SearchResult) -> String {
        switch read.source {
        case .live: return "live · \(read.offers.count) offers"
        case .snapshot: return "snapshot · captured \(Dates.day(read.fetchedAt)) · \(read.offers.count) offers"
        case .fixture: return "fixtures"
        }
    }

    private static func failure(for error: APIError, query: String) -> SearchFailure {
        switch error {
        case .reader(let readerError):
            switch readerError.kind {
            case .challenge, .unknown:
                return SearchFailure(
                    kind: .challenge,
                    title: "Google challenged the server",
                    message: "Google challenged the server; try the fleece demo or a snapshot query. Covered will not bypass a challenge. The live grid needs the desktop reader extension in your own browser."
                )
            case .noOffers:
                return SearchFailure(kind: .noOffers, title: "Nothing on the shelf", message: "No offers came back for “\(query)”. Try another wording.")
            case .timeout:
                return SearchFailure(kind: .other, title: "The reader timed out", message: readerError.message)
            }
        case .network, .http, .walletShort, .decoding:
            return SearchFailure(kind: .other, title: "Search did not finish", message: error.message)
        }
    }
}
