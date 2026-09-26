import XCTest
@testable import Covered

final class ReturnWindowTests: XCTestCase {
    func testThreeDayOldOrderShowsElevenDaysLeft() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let orderDate = now.addingTimeInterval(-3 * 86_400)
        let window = ReturnWindow.compute(orderDate: orderDate, now: now)
        XCTAssertEqual(window.daysElapsed, 3)
        XCTAssertEqual(window.daysRemaining, 11)
        XCTAssertTrue(window.isOpen)
        XCTAssertEqual(window.headline, "11 days left to change your mind")
    }

    func testTwentyDayOldOrderShowsWindowClosed() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let orderDate = now.addingTimeInterval(-20 * 86_400)
        let window = ReturnWindow.compute(orderDate: orderDate, now: now)
        XCTAssertEqual(window.daysElapsed, 20)
        XCTAssertFalse(window.isOpen)
        XCTAssertEqual(window.daysRemaining, 0)
        XCTAssertEqual(window.headline, "Return window closed")
    }
}
