import Capacitor

final class EquanimityBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(EquanimityHealthKitPlugin())
    }
}
