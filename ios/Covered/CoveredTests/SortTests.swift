import XCTest
@testable import Covered

final class SortTests: XCTestCase {
    func testChosenRowStaysPinnedUnderEverySort() {
        let items = [
            item(id: "cheap", title: "Adidas fleece", pence: 1000, delivery: "£4.99 delivery"),
            item(id: "mid", title: "Nike fleece", pence: 2000, delivery: "Free delivery"),
            item(id: "dear", title: "Puma fleece", pence: 3000, delivery: "Collection only"),
        ]
        let chosen = "dear"
        for key in SortKey.allCases {
            let sorted = ListingSort.sort(items, by: key, chosenId: chosen)
            XCTAssertEqual(sorted.first?.id, chosen, "chosen should stay first for \(key.rawValue)")
            XCTAssertEqual(sorted.map(\.id).sorted(), items.map(\.id).sorted())
        }
    }

    func testMonthlyRowsSortAfterCashWhenSortingByPrice() {
        let cash = item(id: "cash", title: "iPhone cash", pence: 89900, delivery: "Free delivery")
        var monthly = item(id: "mo", title: "iPhone 24 months", pence: 3000, delivery: "Free delivery")
        monthly.pricePence = nil
        monthly.priceKind = .monthly
        monthly.monthlyPence = 3000
        monthly.priceLabel = "£30/mo"
        let sorted = ListingSort.sort([monthly, cash], by: .priceAsc)
        XCTAssertEqual(sorted.map(\.id), ["cash", "mo"])
        XCTAssertEqual(ListingSort.pinChosen([cash, monthly], chosenId: "mo").map(\.id), ["cash", "mo"])
    }

    func testFreeShippingSortsBeforePaidDelivery() {
        let free = item(id: "free", title: "A", pence: 3600, delivery: "Free delivery")
        let paid = item(id: "paid", title: "B", pence: 2200, delivery: "£4.99 delivery")
        let sorted = ListingSort.sort([paid, free], by: .shipping)
        XCTAssertEqual(sorted.map(\.id), ["free", "paid"])
        XCTAssertEqual(ListingSort.shippingPence("Free delivery"), 0)
        XCTAssertEqual(ListingSort.shippingPence("£4.99 delivery"), 499)
    }
}

private func item(id: String, title: String, pence: Int, delivery: String) -> ShortlistItem {
    ShortlistItem(
        id: id,
        title: title,
        pricePence: pence,
        priceLabel: formatGBP(pence),
        merchant: "Shop",
        delivery: delivery,
        section: .browse
    )
}
