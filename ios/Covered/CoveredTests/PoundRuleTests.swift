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

    func testShop36WinsAtTenPounds() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumPence: 1000)
        )
        XCTAssertEqual(verdict.chosenId, "shop-36")
        XCTAssertTrue(verdict.summary.contains("JD Sports"))
    }

    func testPrivate28WinsAtFivePounds() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumPence: 500)
        )
        XCTAssertEqual(verdict.chosenId, "private-28")
        XCTAssertTrue(verdict.summary.contains("break is your problem"))
    }

    func testMislistingNeverWins() {
        let verdict = applyPremium(
            items: fixtures,
            decisions: decisions,
            settings: UserSettings(protectionPremiumPence: 1000)
        )
        XCTAssertNotEqual(verdict.chosenId, "mislisting-22")

        let onlyMislisting = applyPremium(
            items: [fixtures[0]],
            decisions: decisions,
            settings: UserSettings(protectionPremiumPence: 1000)
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
            settings: UserSettings(protectionPremiumPence: 1000)
        )
        XCTAssertNil(verdict.chosenId)
        XCTAssertTrue(verdict.summary.contains("Nothing to buy"))
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
