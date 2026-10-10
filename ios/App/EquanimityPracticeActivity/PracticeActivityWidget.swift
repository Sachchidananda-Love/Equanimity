import ActivityKit
import SwiftUI
import WidgetKit

@main
struct EquanimityPracticeWidgets: WidgetBundle {
    var body: some Widget { PracticeActivityWidget() }
}

struct PracticeActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PracticeActivityAttributes.self) { context in
            PracticeLockScreenView(title: context.attributes.title, state: context.state, stale: context.isStale)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Text("Equanimity").font(.headline).foregroundStyle(.white) }
                DynamicIslandExpandedRegion(.trailing) { Image(systemName: "timer").foregroundStyle(.white) }
                DynamicIslandExpandedRegion(.bottom) { countdown(context) }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(.white)
            } compactTrailing: {
                countdown(context).frame(maxWidth: 70)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(.white)
            }
        }
    }
    @ViewBuilder private func countdown(_ context: ActivityViewContext<PracticeActivityAttributes>) -> some View {
        if context.isStale { Text("Done").foregroundStyle(.white) }
        else { Text(timerInterval: context.state.startedAt...context.state.endAt, countsDown: true).monospacedDigit().foregroundStyle(.white) }
    }
}

struct PracticeLockScreenView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    let title: String
    let state: PracticeActivityAttributes.ContentState
    let stale: Bool
    private var dark: Bool { colorScheme == .dark || luminanceReduced }
    private var background: Color { dark ? Color(red: 0.08, green: 0.13, blue: 0.11) : Color(red: 0.97, green: 0.96, blue: 0.92) }
    private var foreground: Color { dark ? .white : .black }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Equanimity · \(title)").font(.headline)
            if stale { Text("Practice finished").font(.title3) }
            else {
                Text(timerInterval: state.startedAt...state.endAt, countsDown: true)
                    .font(.system(.largeTitle, design: .rounded)).monospacedDigit()
                    .accessibilityLabel("Practice time remaining")
                HStack { Text("Ends"); Text(state.endAt, style: .time) }.font(.caption)
            }
        }
        .padding()
        // Action foreground affects only the system auxiliary button. Explicit
        // content foreground + opaque backing prevents white-on-light material.
        .foregroundStyle(foreground)
        .background(background)
        .activityBackgroundTint(background)
        .activitySystemActionForegroundColor(foreground)
    }
}
