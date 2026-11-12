package r2lab;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
public class GuardProbe {
    public static void main(String[] args){
        AtomicInteger calls=new AtomicInteger();
        Instrumentation fake=(Instrumentation)Proxy.newProxyInstance(GuardProbe.class.getClassLoader(),new Class[]{Instrumentation.class},
            (proxy,method,values)->{calls.incrementAndGet();return null;});
        boolean rejected=false;
        try{NativeAgent.agentmain("export1",fake);}catch(IllegalStateException expected){rejected=true;}
        if(!rejected||calls.get()!=0)throw new IllegalStateException("R2_GUARD_FAILED");
        System.out.println("R2_AGENT_GUARD_BEFORE_INSTRUMENTATION");
    }
}
