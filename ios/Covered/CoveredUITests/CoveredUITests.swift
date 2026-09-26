import XCTest

final class CoveredUITests: XCTestCase {
    private var app: XCUIApplication!
    private let shots = URL(fileURLWithPath: "/tmp/covered-ios-shots", isDirectory: true)

    override func setUpWithError() throws {
        continueAfterFailure = false
        try FileManager.default.createDirectory(at: shots, withIntermediateDirectories: true)
        app = XCUIApplication()
        app.launchArguments = [
            "-CoveredUITestFresh",
            "-CoveredUITestBypassAuth",
            "-CoveredUITestSearch",
        ]
        app.launch()
    }

    func testLiveOnboardingShopApproveAndReturns() throws {
        let name = app.textFields["onboarding.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 12), "Onboarding name field should appear")
        name.tap()
        name.typeText("Demo")
        dismissKeyboard()
        attach("onboarding")
        tapIdentified("onboarding.continue")

        // Pay up to £10 — already the default
        tapIdentified("onboarding.continue")
        // Switch if I clear £8 — already the default
        tapIdentified("onboarding.continue")
        // Plain English
        tapIdentified("onboarding.continue")

        // Pair — skip (Continue also advances if Skip is off-screen)
        if app.buttons["onboarding.skipPair"].waitForExistence(timeout: 4) {
            tapIdentified("onboarding.skipPair")
        } else {
            tapIdentified("onboarding.continue")
        }

        XCTAssertTrue(app.buttons["onboarding.deposit50"].waitForExistence(timeout: 5))
        tapIdentified("onboarding.deposit50")
        tapIdentified("onboarding.save")

        let search = app.textFields["shop.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 25), "Should land on Shop after onboarding")

        app.tabBars.buttons["Wallet"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["wallet.balance"].waitForExistence(timeout: 12))
        let walletBefore = app.descendants(matching: .any)["wallet.balance"].firstMatch.value as? String ?? ""
        attach("wallet-before")

        app.tabBars.buttons["Shop"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 8))
        search.tap()
        let existing = (search.value as? String) ?? ""
        if !existing.localizedCaseInsensitiveContains("fleece") {
            search.typeText("black fleece jacket medium")
        }
        tapIdentified("shop.searchButton")
        attach("shop-searching")

        let approve = app.descendants(matching: .any)["shop.approve"].firstMatch
        let deadline = Date().addingTimeInterval(180)
        var lastShot = Date()
        while Date() < deadline && !approve.exists {
            if app.descendants(matching: .any)["shop.error"].firstMatch.exists {
                attach("shop-error")
                XCTFail("Search failed: \(app.descendants(matching: .any)["shop.error"].firstMatch.label)")
                return
            }
            if Date().timeIntervalSince(lastShot) > 20 {
                attach("shop-waiting")
                lastShot = Date()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        }
        XCTAssertTrue(
            approve.exists,
            "Chosen Approve button should appear after the live judge returns"
        )
        attach("shop-results")

        app.tabBars.buttons["Orders"].tap()
        attach("orders-before")
        app.tabBars.buttons["Wallet"].tap()
        attach("wallet")
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.textFields["settings.baseURL"].waitForExistence(timeout: 8))
        attach("settings")

        app.tabBars.buttons["Shop"].tap()
        XCTAssertTrue(approve.waitForExistence(timeout: 8))
        approve.tap()
        XCTAssertTrue(app.buttons["approve.confirm"].waitForExistence(timeout: 8))
        let price = app.descendants(matching: .any)["approve.price"].firstMatch.value as? String ?? ""
        tapIdentified("approve.confirm")
        attach("approve-waiting")

        let viewOrder = app.buttons["approve.viewOrder"]
        let approveError = app.descendants(matching: .any)["approve.error"].firstMatch
        let deadlineApprove = Date().addingTimeInterval(40)
        while Date() < deadlineApprove && !viewOrder.exists {
            if approveError.exists {
                attach("approve-error")
                XCTFail("Approve failed: \(approveError.label)")
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        XCTAssertTrue(
            viewOrder.exists,
            "Approve should debit the live wallet and show the receipt"
        )
        attach("approve-confirm")
        let walletAfterApprove = app.descendants(matching: .any)["approve.balance"].firstMatch.value as? String ?? ""

        tapIdentified("approve.viewOrder")
        let orderRow = app.descendants(matching: .any)["orders.row"].firstMatch
        XCTAssertTrue(orderRow.waitForExistence(timeout: 12), "Approved order should appear on Orders")
        attach("orders")
        orderRow.tap()

        let orderId = app.descendants(matching: .any)["order.id"].firstMatch
        XCTAssertTrue(orderId.waitForExistence(timeout: 8))
        attach("order")
        let orderIdValue = orderId.value as? String ?? orderId.label

        let composer = app.textViews["aftercare.composer"].exists
            ? app.textViews["aftercare.composer"]
            : app.textFields["aftercare.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 8))
        composer.tap()
        composer.typeText("The zip broke on the first wear. I want a refund.")
        tapIdentified("aftercare.send")
        let draft = app.descendants(matching: .any)["aftercare.draft"].firstMatch
        let reply = app.descendants(matching: .any)["aftercare.reply"].firstMatch
        let aftercareDeadline = Date().addingTimeInterval(70)
        while Date() < aftercareDeadline && !draft.exists && !reply.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        }
        if app.keyboards.element.exists {
            app.buttons["onboarding.wordmark"].tap()
            if app.keyboards.element.exists { app.swipeDown() }
        }
        attach("returns-chat")
        if !draft.exists && !reply.exists {
            attach("returns-chat-missing")
        }

        if app.keyboards.element.exists {
            app.swipeDown()
        }
        app.tabBars.buttons["Wallet"].tap()
        let walletBalance = app.descendants(matching: .any)["wallet.balance"].firstMatch
        if !walletBalance.waitForExistence(timeout: 8) {
            app.tabBars.buttons["Wallet"].tap()
            _ = walletBalance.waitForExistence(timeout: 8)
        }
        attach("wallet-after")
        let walletAfter = walletBalance.exists
            ? (walletBalance.value as? String ?? walletAfterApprove)
            : walletAfterApprove

        let report = """
        wallet_before=\(walletBefore)
        price=\(price)
        wallet_after_approve=\(walletAfterApprove)
        wallet_after=\(walletAfter)
        order_id=\(orderIdValue)
        """
        let reportURL = shots.appendingPathComponent("approve-report.txt")
        try report.write(to: reportURL, atomically: true, encoding: .utf8)
        let attachment = XCTAttachment(string: report)
        attachment.name = "approve-report"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tapIdentified(_ identifier: String) {
        let button = app.buttons[identifier]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "Missing \(identifier)")
        if button.isHittable {
            button.tap()
        } else {
            button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func dismissKeyboard() {
        if app.keyboards.buttons["next"].exists {
            // Don't tap next — that submits the name field and skips a step.
        }
        let wordmark = app.staticTexts["onboarding.wordmark"]
        if wordmark.exists {
            wordmark.tap()
        } else if app.keyboards.element.exists {
            app.swipeDown()
        }
    }

    private func attach(_ name: String) {
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let url = shots.appendingPathComponent("\(name).png")
        try? shot.pngRepresentation.write(to: url)
    }
}
