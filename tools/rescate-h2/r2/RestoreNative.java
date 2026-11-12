package r2lab;
import java.nio.file.*;
import java.sql.*;
import org.h2.tools.RunScript;
public class RestoreNative {
    public static void main(String[] args){try{
        NativeAgent.guard();
        if(args.length!=1||!args[0].matches("(?:verify)?[12]"))throw new IllegalArgumentException();
        boolean verify=args[0].startsWith("verify");String n=args[0].substring(args[0].length()-1);
        Path db=NativeAgent.OUT.resolve("restored-"+n);
        if(verify){
            try(Connection c=DriverManager.getConnection("jdbc:h2:file:"+db+";IFEXISTS=TRUE","sa","")){
                NativeAgent.write(NativeAgent.OUT.resolve("reopened-"+n+".json"),NativeAgent.json(NativeAgent.snapshot(c)));
            }
            System.out.println("R2_REOPENED_IN_NEW_JVM");return;
        }
        if(Files.exists(Path.of(db+".mv.db")))throw new IllegalStateException();
        String url="jdbc:h2:file:"+db;
        String first;
        try(Connection c=DriverManager.getConnection(url,"sa","")){
            RunScript.execute(c,Files.newBufferedReader(NativeAgent.OUT.resolve("export"+args[0]+".sql")));
            first=NativeAgent.json(NativeAgent.snapshot(c));
        }
        try(Connection c=DriverManager.getConnection(url+";IFEXISTS=TRUE","sa","")){
            String reopened=NativeAgent.json(NativeAgent.snapshot(c));if(!first.equals(reopened))throw new IllegalStateException();
        }
        NativeAgent.write(NativeAgent.OUT.resolve("restored-"+args[0]+".json"),first);
        System.out.println("R2_RESTORED_AND_REOPENED");
    }catch(Exception e){System.err.println("R2_RESTORE_FAILED:"+e.getClass().getSimpleName());System.exit(1);}}
}
