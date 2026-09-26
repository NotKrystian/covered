import XCTest
@testable import Covered

final class ReturnWindowTests: XCTestCase {
    func testThreeDayOldOrderShowsElevenDaysLeft() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ends = now.addingTimeInterval(11 * 86_400)
        let window = ReturnWindow.from(endsAt: iso(ends), blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 11)
        XCTAssertTrue(window.isOpen)
        XCTAssertEqual(window.headline, "11 days left to change your mind")
    }

    func testTwentyDayOldOrderShowsWindowClosed() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ends = now.addingTimeInterval(-6 * 86_400)
        let window = ReturnWindow.from(endsAt: iso(ends), blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 0)
        XCTAssertFalse(window.isOpen)
        XCTAssertEqual(window.headline, "Return window closed")
    }

    func testBlockedPrivateSellerUsesServerReason() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ends = now.addingTimeInterval(10 * 86_400)
        let window = ReturnWindow.from(
            endsAt: iso(ends),
            blocked: "private seller, so there is no 14-day right to cancel",
            now: now
        )
        XCTAssertFalse(window.isOpen)
        XCTAssertEqual(window.headline, "private seller, so there is no 14-day right to cancel")
    }

    func testPairingCodeUppercasesAndDropsAmbiguousGlyphs() {
        XCTAssertEqual(PairingCode.normalize(" ab o1i2 "), "AB2")
        XCTAssertEqual(PairingCode.normalize("xk7m2p"), "XK7M2P")
    }

    func testOfferEncodesRequiredNulls() throws {
        let offer = Offer(
            section: .browse,
            position: nil,
            title: "Black fleece",
            price: "£36.00",
            pricePence: 3600,
            compareAt: nil,
            merchant: "JD Sports",
            merchantDomain: nil,
            merchantId: nil,
            offerId: nil,
            offerDocid: nil,
            location: nil,
            badge: nil,
            delivery: nil,
            returns: nil,
            energy: nil,
            rating: nil,
            ratingCount: nil,
            specs: nil,
            productUrl: nil,
            moreMerchants: nil,
            summary: nil,
            imageUrls: nil,
            imageUrl: nil,
            imageDataUrl: nil
        )
        let data = try JSONEncoder.covered.encode(offer)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(json.keys.contains("compare_at"))
        XCTAssertTrue(json["compare_at"] is NSNull)
        XCTAssertTrue(json["badge"] is NSNull)
        XCTAssertTrue(json["delivery"] is NSNull)
        XCTAssertTrue(json["rating"] is NSNull)
        XCTAssertTrue(json["rating_count"] is NSNull)
    }

    private func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}
