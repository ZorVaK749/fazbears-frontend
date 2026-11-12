package r2lab;
import com.sun.tools.attach.VirtualMachine;
public class AttachClient {
    public static void main(String[] args) {
        try {
            NativeAgent.guard();
            if(args.length!=1)throw new IllegalArgumentException();
            VirtualMachine vm=VirtualMachine.attach("1");
            try {vm.loadAgent("/r2-tools/agent.jar",args[0]);} finally {vm.detach();}
            System.out.println("R2_AGENT_RETURNED");
        } catch(Exception e) {System.err.println("R2_ATTACH_FAILED:"+e.getClass().getSimpleName());System.exit(1);}
    }
}
