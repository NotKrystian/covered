import XCTest
@testable import Covered

final class ReturnWindowTests: XCTestCase {
    /// Exclusive `ends_at` = 16 Jan 2024 00:00 London → last valid day is 15 Jan.
    /// Order day 1 Jan → 14 days left.
    func testOrderDayShowsFourteenDaysLeft() {
        let ends = londonMidnight(year: 2024, month: 1, day: 16)
        let now = londonNoon(year: 2024, month: 1, day: 1)
        let window = ReturnWindow.from(ends: ends, blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 14)
        XCTAssertTrue(window.isOpen)
        XCTAssertEqual(window.headline, "14 days left")
    }

    func testNextDayShowsThirteenDaysLeft() {
        let ends = londonMidnight(year: 2024, month: 1, day: 16)
        let now = londonNoon(year: 2024, month: 1, day: 2)
        let window = ReturnWindow.from(ends: ends, blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 13)
        XCTAssertTrue(window.isOpen)
        XCTAssertEqual(window.headline, "13 days left")
    }

    func testLastDayShowsLastDay() {
        let ends = londonMidnight(year: 2024, month: 1, day: 16)
        let now = londonNoon(year: 2024, month: 1, day: 15)
        let window = ReturnWindow.from(ends: ends, blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 1)
        XCTAssertTrue(window.isOpen)
        XCTAssertEqual(window.headline, "last day")
    }

    func testAfterEndsAtShowsWindowClosed() {
        let ends = londonMidnight(year: 2024, month: 1, day: 16)
        let now = londonMidnight(year: 2024, month: 1, day: 16).addingTimeInterval(60)
        let window = ReturnWindow.from(ends: ends, blocked: nil, now: now)
        XCTAssertEqual(window.daysRemaining, 0)
        XCTAssertFalse(window.isOpen)
        XCTAssertEqual(window.headline, "window closed")
    }

    func testBlockedPrivateSellerUsesServerReason() {
        let ends = londonMidnight(year: 2024, month: 1, day: 16)
        let now = londonNoon(year: 2024, month: 1, day: 1)
        let window = ReturnWindow.from(
            ends: ends,
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

    func testFleeceDemoQuery() {
        XCTAssertTrue(isFleeceDemoQuery("black fleece jacket medium"))
        XCTAssertTrue(isFleeceDemoQuery("  Fleece  "))
        XCTAssertFalse(isFleeceDemoQuery("sony headphones"))
    }

    private func londonMidnight(year: Int, month: Int, day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = ReturnWindow.london
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 0, minute: 0))!
    }

    private func londonNoon(year: Int, month: Int, day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = ReturnWindow.london
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12, minute: 0))!
    }
}
