package r2lab;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
public class ArtifactInspect {
    public static void main(String[] args)throws Exception{
        Path jar=Path.of(args[0]),out=Path.of(args[1]);Map<String,Object> result=new TreeMap<>();
        result.put("jarSha256",NativeAgent.hash(Files.readAllBytes(jar)));
        try(ZipFile zip=new ZipFile(jar.toFile())){
            List<String> libs=new ArrayList<>();Map<String,String> classes=new TreeMap<>();
            for(var entry:Collections.list(zip.entries())){
                String name=entry.getName();
                if(name.startsWith("BOOT-INF/lib/"))libs.add(name.substring("BOOT-INF/lib/".length()));
                if(name.startsWith("BOOT-INF/classes/")&&name.endsWith(".class"))try(var in=zip.getInputStream(entry)){classes.put(name,NativeAgent.hash(in.readAllBytes()));}
            }
            Collections.sort(libs);result.put("libraries",libs);result.put("applicationClassesSha256",classes);
            var h2=zip.getEntry("BOOT-INF/lib/h2-2.4.240.jar");if(h2==null)throw new IllegalStateException();
            try(var in=zip.getInputStream(h2)){Files.copy(in,out);}
            result.put("h2JarSha256",NativeAgent.hash(Files.readAllBytes(out)));
            Properties properties=new Properties();try(var in=zip.getInputStream(zip.getEntry("BOOT-INF/classes/application.properties"))){properties.load(in);}
            String url=properties.getProperty("spring.datasource.url","");
            if(!url.startsWith("jdbc:h2:mem:carritodb")&&!url.startsWith("jdbc:h2:mem:pedidosdb"))throw new IllegalStateException();
            result.put("memoryDatabaseConfirmed",true);
            result.put("ddlCreateDrop",properties.getProperty("spring.jpa.hibernate.ddl-auto","").equals("create-drop"));
            result.put("serverPort",properties.getProperty("server.port"));
        }
        System.out.println(NativeAgent.json(result));
    }
}
