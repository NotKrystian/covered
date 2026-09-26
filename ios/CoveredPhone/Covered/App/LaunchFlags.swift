// Launch arguments for screenshots and UI tests. Debug builds only.
//   -demo-onboarded <name>   mark this uid onboarded (PATCH /api/memory) and skip the flow
//   -demo-fixtures           run the fleece fixtures as soon as Home appears
//   -demo-approve            open the pay sheet once the fixture verdict lands
//   -demo-tab <shop|orders|limits|settings>   start on that tab
import Foundation

enum LaunchFlags {
    private static var arguments: [String] {
        #if DEBUG
        return ProcessInfo.processInfo.arguments
        #else
        return []
        #endif
    }

    private static func value(after flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    static var demoOnboardedName: String? { value(after: "-demo-onboarded") }
    static var demoFixtures: Bool { arguments.contains("-demo-fixtures") }
    static var demoApprove: Bool { arguments.contains("-demo-approve") }
    static var demoTab: String? { value(after: "-demo-tab") }
}
