import Foundation
import Observation

enum ShopPhase: Equatable {
    case idle
    case readingLaptop
    case searching
    case judging(Int)
}

@MainActor
@Observable
final class ShopModel {
    var query = ""
    var phase: ShopPhase = .idle
    var statusText = ""
    var errorText: String?
    var items: [ShortlistItem] = []
    var decisions: [String: Decision] = [:]
    var verdict: Verdict?
    var briefBrand = ""
    var judgedQuery = ""
    var sourceLabel = ""
    var sort: SortKey = .default
    var localPremiumPence = UserSettings.defaults.protectionPremiumPence
    var approveCheck = false
    var approvedBalancePence: Int?
    var approvedOrderId: String?
    var walletShortfallPence: Int?
    var walletShortMessage: String?

    var isBusy: Bool {
        switch phase {
        case .readingLaptop, .searching, .judging:
            return true
        case .idle:
            return false
        }
    }

    var rows: [ShortlistItem] {
        ListingSort.sort(
            items,
            by: sort,
            decisions: decisions,
            briefBrand: briefBrand,
            chosenId: verdict?.chosenId
        )
    }

    var chosenItem: ShortlistItem? {
        guard let id = verdict?.chosenId else { return nil }
        return items.first(where: { $0.id == id })
    }

    func resetReceipt() {
        approveCheck = false
        approvedBalancePence = nil
        approvedOrderId = nil
        walletShortfallPence = nil
        walletShortMessage = nil
    }

    func applyLocalPremium(_ pence: Int) {
        localPremiumPence = pence
        guard !items.isEmpty, !decisions.isEmpty else { return }
        var next = AppState.shared.settings
        next.protectionPremiumPence = pence
        verdict = applyPremium(items: items, decisions: decisions, settings: next)
    }

    func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !isBusy else { return }
        errorText = nil
        resetReceipt()
        items = []
        decisions = [:]
        verdict = nil
        localPremiumPence = AppState.shared.settings.protectionPremiumPence

        var offers: [Offer]?
        var source: SearchSource?
        var label = ""

        if KeychainToken.isPaired {
            phase = .readingLaptop
            statusText = "Reading Google Shopping on your laptop…"
            do {
                offers = try await pollReader(query: q)
                source = .live
                label = "laptop reader · \(offers?.count ?? 0) offers"
            } catch let error as APIError {
                if case .http(let status, let message) = error, status == 401 {
                    errorText = message
                    offers = nil
                } else {
                    offers = nil
                }
            } catch {
                offers = nil
            }
        }

        if offers == nil {
            phase = .searching
            statusText = "Searching…"
            do {
                let result = try await AppState.shared.api.search(query: q)
                offers = result.offers
                source = result.source
                switch result.source {
                case .live:
                    label = "live · \(result.offers.count) offers"
                case .snapshot:
                    label = "snapshot · \(result.offers.count) offers"
                case .fixture:
                    label = "fixtures · \(result.offers.count) listings"
                }
            } catch let error as APIError {
                phase = .idle
                statusText = ""
                errorText = plainSearchError(error)
                return
            } catch {
                phase = .idle
                statusText = ""
                errorText = error.localizedDescription
                return
            }
        }

        guard let offers else {
            phase = .idle
            statusText = ""
            errorText = "Nothing on the shelf for that search."
            return
        }

        if offers.isEmpty {
            phase = .idle
            statusText = ""
            items = []
            sourceLabel = label
            judgedQuery = q
            return
        }

        phase = .judging(offers.count)
        statusText = "Judging \(offers.count) listings…"
        do {
            let decided = try await AppState.shared.api.decide(
                query: q,
                settings: AppState.shared.settings,
                source: source,
                offers: offers,
                fetchedAt: ISO8601DateFormatter().string(from: Date())
            )
            items = decided.allRows
            decisions = decided.decisions
            if decided.decisions.isEmpty {
                decisions = decided.verdict.perOffer
            }
            briefBrand = decided.briefBrand ?? ""
            judgedQuery = q
            sourceLabel = label
            applyLocalPremium(localPremiumPence)
            if verdict == nil {
                verdict = decided.verdict
            }
            AppState.shared.verdict = decided
            AppState.shared.searchResult = SearchResult(
                query: q,
                fetchedAt: ISO8601DateFormatter().string(from: Date()),
                source: source ?? .live,
                offers: offers
            )
        } catch let error as APIError {
            errorText = plainSearchError(error)
        } catch {
            errorText = error.localizedDescription
        }
        phase = .idle
        statusText = ""
    }

    private func pollReader(query: String) async throws -> [Offer] {
        let created = try await AppState.shared.api.startReaderJob(query: query)
        guard let jobId = created.jobId, !jobId.isEmpty else {
            throw APIError.unexpected(message: "The reader did not return a job id")
        }

        let readerOffline = created.readerOnline == false
        if readerOffline {
            statusText = "Open Brave on your laptop — the Covered reader hasn't checked in"
        }

        let started = Date()
        let deadline = started.addingTimeInterval(45)
        while Date() < deadline {
            if readerOffline, Date().timeIntervalSince(started) >= 10 {
                throw APIError.unexpected(message: "reader_offline")
            }
            let job = try await AppState.shared.api.readerJob(id: jobId)
            switch job.status {
            case .queued, .running:
                try await Task.sleep(for: .seconds(1))
            case .done:
                if let offers = job.result?.offers { return offers }
                throw APIError.unexpected(message: "The laptop finished without offers.")
            case .failed, .challenge:
                throw APIError.unexpected(message: job.error ?? "The laptop reader did not finish.")
            }
        }
        throw APIError.unexpected(message: "The laptop reader timed out.")
    }

    func approve(item: ShortlistItem) async {
        guard let decision = decisions[item.id] else { return }
        resetReceipt()
        let receipt = Receipt(
            id: UUID().uuidString,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            query: judgedQuery,
            chosen: item.chosenPayload(),
            decision: decision,
            section: item.section,
            protectionPremiumPence: localPremiumPence,
            chosenId: item.id
        )
        do {
            let response = try await AppState.shared.approve(receipt: receipt)
            approveCheck = true
            approvedBalancePence = response.balancePence ?? AppState.shared.wallet?.balancePence
            approvedOrderId = response.id
            Haptics.success()
        } catch let error as APIError {
            if case .walletShort(let message) = error {
                let balance = AppState.shared.wallet?.balancePence ?? 0
                let price = item.pricePence ?? 0
                walletShortfallPence = max(0, price - balance)
                walletShortMessage = message
            } else {
                errorText = error.errorDescription ?? "Approve failed."
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    func createLimit(for item: ShortlistItem, maxPence: Int) async throws {
        let q = judgedQuery.isEmpty ? query : judgedQuery
        try await AppState.shared.createLimit(query: q, maxPence: maxPence)
    }
}
