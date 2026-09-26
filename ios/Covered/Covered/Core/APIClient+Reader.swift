import Foundation

struct PairClaim: Codable, Sendable {
    var ok: Bool?
    var userId: String?
    var token: String?
    var tokenType: String?
    var pairedDevices: Int?
    var error: String?
}

enum ReaderJobStatus: String, Codable, Sendable, Hashable {
    case queued
    case running
    case done
    case failed
    case challenge
}

struct ReaderJobSnapshot: Codable, Sendable, Hashable {
    var jobId: String
    var status: ReaderJobStatus
    var result: SearchResult?
    var error: String?
}

private struct ReaderJobCreateResponse: Codable, Sendable {
    var ok: Bool?
    var jobId: String?
    var status: ReaderJobStatus?
    var error: String?
}

private struct ReaderJobEnvelope: Codable, Sendable {
    var ok: Bool?
    var jobId: String?
    var status: ReaderJobStatus?
    var result: SearchResult?
    var error: String?
    var job: Nested?

    struct Nested: Codable, Sendable {
        var jobId: String?
        var status: ReaderJobStatus?
        var result: SearchResult?
        var error: String?
    }

    func resolved(fallbackId: String) -> ReaderJobSnapshot {
        let id = job?.jobId ?? jobId ?? fallbackId
        let status = job?.status ?? status ?? .failed
        return ReaderJobSnapshot(
            jobId: id,
            status: status,
            result: job?.result ?? result,
            error: job?.error ?? error
        )
    }
}

extension APIClient {
    func claimPair(code: String) async throws -> PairClaim {
        struct Body: Encodable {
            var code: String
            var label: String
        }
        let body = Body(code: code, label: "iPhone")
        do {
            let claimed: PairClaim = try await send("POST", "/api/pair/claim", body: body)
            if claimed.ok == false {
                throw APIError.http(status: 400, message: claimed.error ?? "Could not pair.")
            }
            if let token = claimed.token, !token.isEmpty {
                KeychainToken.store(token)
            }
            return claimed
        } catch let error as APIError {
            throw Self.rewriteMissingRoute(error, message: "Pairing isn't live on the server yet")
        }
    }

    func startReaderJob(query: String) async throws -> String {
        struct Body: Encodable { var query: String }
        do {
            let response: ReaderJobCreateResponse = try await send(
                "POST",
                "/api/reader/jobs",
                body: Body(query: query)
            )
            if response.ok == false {
                throw APIError.unexpected(message: response.error ?? "Could not start the laptop reader")
            }
            guard let id = response.jobId, !id.isEmpty else {
                throw APIError.unexpected(message: "The reader did not return a job id")
            }
            return id
        } catch let error as APIError {
            throw Self.rewriteMissingRoute(error, message: "The laptop reader isn't live on the server yet")
        }
    }

    func readerJob(id: String) async throws -> ReaderJobSnapshot {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        do {
            let envelope: ReaderJobEnvelope = try await send("GET", "/api/reader/jobs/\(encoded)")
            return envelope.resolved(fallbackId: id)
        } catch let error as APIError {
            throw Self.rewriteMissingRoute(error, message: "The laptop reader isn't live on the server yet")
        }
    }

    private static func rewriteMissingRoute(_ error: APIError, message: String) -> APIError {
        if case .http(let status, _) = error, status == 404 {
            return .http(status: 404, message: message)
        }
        return error
    }
}
