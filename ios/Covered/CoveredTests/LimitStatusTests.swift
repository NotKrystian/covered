import XCTest
@testable import Covered

final class LimitStatusTests: XCTestCase {
    func testLastResultShortMapsToWalletShortChip() {
        let chip = LimitStatusChip.resolve(
            statusRaw: "watching",
            lastResult: "Wallet short by £4.00"
        )
        XCTAssertEqual(chip, .walletShort)
        XCTAssertEqual(chip.rawValue, "Wallet short")
    }

    func testFilledStatusMapsToFilledChip() {
        let chip = LimitStatusChip.resolve(statusRaw: "filled", lastResult: "bought JD Sports")
        XCTAssertEqual(chip, .filled)
        XCTAssertEqual(chip.rawValue, "Filled")
    }
}
