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

struct ReaderJobCreateResponse: Codable, Sendable {
    var ok: Bool?
    var jobId: String?
    var status: ReaderJobStatus?
    var createdAt: String?
    var expiresAt: String?
    var readerSeenAt: String?
    var readerOnline: Bool?
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
        let claimed: PairClaim
        let status: Int
        (claimed, status) = try await sendRaw("POST", "/api/pair/claim", body: body)
        if status == 404 {
            if claimed.ok == false || claimed.error != nil {
                throw APIError.http(
                    status: 404,
                    message: "That code isn't valid — get a fresh one from the Covered icon in Brave"
                )
            }
            throw APIError.http(status: 404, message: "route_missing")
        }
        if claimed.ok == false {
            throw APIError.http(status: status >= 400 ? status : 400, message: claimed.error ?? "Could not pair.")
        }
        if status >= 400 {
            throw APIError.http(status: status, message: claimed.error ?? "Could not pair (\(status)).")
        }
        if let token = claimed.token, !token.isEmpty {
            KeychainToken.store(token)
        }
        return claimed
    }

    func startReaderJob(query: String) async throws -> ReaderJobCreateResponse {
        struct Body: Encodable { var query: String }
        let response: ReaderJobCreateResponse
        let status: Int
        (response, status) = try await sendRaw(
            "POST",
            "/api/reader/jobs",
            body: Body(query: query)
        )
        if status == 201 || (status < 400 && response.ok != false) {
            if response.ok == false {
                throw APIError.unexpected(message: response.error ?? "Could not start the laptop reader")
            }
            guard let id = response.jobId, !id.isEmpty else {
                throw APIError.unexpected(message: "The reader did not return a job id")
            }
            return response
        }
        if status == 404, !((response.error ?? "").isEmpty) {
            throw APIError.http(status: 404, message: response.error ?? "route_missing")
        }
        if status >= 400 {
            throw APIError.http(status: status, message: response.error ?? "Could not start the laptop reader")
        }
        throw APIError.unexpected(message: response.error ?? "Could not start the laptop reader")
    }

    func readerJob(id: String) async throws -> ReaderJobSnapshot {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let envelope: ReaderJobEnvelope = try await send("GET", "/api/reader/jobs/\(encoded)")
        return envelope.resolved(fallbackId: id)
    }
}
