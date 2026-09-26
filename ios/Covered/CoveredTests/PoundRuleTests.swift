import XCTest
@testable import Covered

final class PoundRuleTests: XCTestCase {
    private let fixtures: [ShortlistItem] = [
        item(id: "mislisting-22", pence: 2200, merchant: "dealz_direct_uk"),
        item(id: "private-28", pence: 2800, merchant: "Facebook Marketplace · Tom K"),
        item(id: "shop-36", pence: 3600, merchant: "JD Sports"),
        item(id: "overseas-34", pence: 3400, merchant: "GlobalStyle Outlet"),
    ]

    private let decisions: [String: Decision] = [
        "mislisting-22": decision(sameItem: false, mislisting: true, seller: .unclear, venue: .marketplaceUnprotected),
        "private-28": decision(sameItem: true, mislisting: false, seller: .privateSeller, venue: .stranger),
        "shop-36": decision(sameItem: true, mislisting: false, seller: .ukBusiness, venue: .shopCheckout),
        "overseas-34": decision(sameItem: true, mislisting: false, seller: .overseasBusiness, venue: .marketplaceUnprotected),
    ]

    func testFleeceDiscountIsTwentyTwoPercent() {
        XCTAssertEqual(discountRatioBps(protected: 3600, unprotected: 2800), 2222)
        XCTAssertTrue(shopBeatsPremium(protected: 3600, unprotected: 2800, bps: 2500))
        XCTAssertFalse(shopBeatsPremium(protected: 3600, unprotected: 2800, bps: 1500))
    }

    func testShop36WinsAtTwentyFivePercent() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumBps: 2500)
        )
        XCTAssertEqual(verdict.chosenId, "shop-36")
        XCTAssertTrue(verdict.summary.contains("JD Sports"))
    }

    func testPrivate28WinsAtFifteenPercent() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumBps: 1500)
        )
        XCTAssertEqual(verdict.chosenId, "private-28")
        XCTAssertTrue(verdict.summary.contains("break is your problem"))
    }

    func testShopWinsWhenCheaperOrAlone() {
        XCTAssertTrue(shopBeatsPremium(protected: 2800, unprotected: 3600, bps: 0))
        XCTAssertTrue(shopBeatsPremium(protected: 3600, unprotected: nil, bps: 0))
    }

    func testMislistingNeverWins() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumBps: 2500)
        )
        XCTAssertNotEqual(verdict.chosenId, "mislisting-22")

        let onlyMislisting = applyPremium(
            items: [fixtures[0]],
            decisions: decisions,
            settings: UserSettings(protectionPremiumBps: 2500)
        )
        XCTAssertNil(onlyMislisting.chosenId)
        XCTAssertTrue(onlyMislisting.summary.contains("Nothing to buy"))
    }

    func testNothingSurvives() {
        let none: [String: Decision] = [
            "mislisting-22": decision(sameItem: false, mislisting: true, seller: .unclear, venue: .unclear),
            "private-28": decision(sameItem: false, mislisting: false, seller: .privateSeller, venue: .stranger),
            "shop-36": decision(sameItem: false, mislisting: false, seller: .ukBusiness, venue: .shopCheckout),
            "overseas-34": decision(sameItem: false, mislisting: false, seller: .overseasBusiness, venue: .unclear),
        ]
        let verdict = applyPremium(
            items: fixtures,
            decisions: none,
            settings: UserSettings(protectionPremiumBps: 2500)
        )
        XCTAssertNil(verdict.chosenId)
        XCTAssertTrue(verdict.summary.contains("Nothing to buy"))
    }

    func testSettingsEncodeBpsAndLegacyPence() throws {
        let settings = UserSettings(protectionPremiumBps: 2500, protectionPremiumPence: 0)
        let data = try JSONEncoder.covered.encode(settings)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["protection_premium_bps"] as? Int, 2500)
        XCTAssertEqual(json["protection_premium_pence"] as? Int, 0)
        XCTAssertEqual(json["switch_minimum_pence"] as? Int, 800)
    }
}

private func item(id: String, pence: Int, merchant: String) -> ShortlistItem {
    ShortlistItem(
        id: id,
        title: id,
        pricePence: pence,
        priceLabel: formatGBP(pence),
        merchant: merchant,
        section: .fixture
    )
}

private func decision(
    sameItem: Bool,
    mislisting: Bool,
    seller: SellerType,
    venue: VenueTrust
) -> Decision {
    Decision(
        sameItem: sameItem,
        mislisting: mislisting,
        photoReason: mislisting ? "photo shows a nylon bomber jacket, not a fleece" : nil,
        sponsored: false,
        sellerType: seller,
        venueTrust: venue,
        rights: [],
        recommendation: sameItem && !mislisting ? .buy : .skip,
        reason: ""
    )
}
