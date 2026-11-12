package r2lab;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
public class Probe {
    public static void main(String[] args){try{
        NativeAgent.guard();String kind=System.getenv("R2_KIND"),port=kind.equals("carrito")?"8083":"8082";
        String path=kind.equals("carrito")?"/api/carrito/"+NativeAgent.OWNER:"/api/pedidos/usuario/"+NativeAgent.OWNER;
        HttpClient c=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        if(args.length>0&&args[0].equals("ready")){
            if(request(c,port,path,false)!=401)throw new IllegalStateException();
            System.out.println("R2_READY_401");return;
        }
        if(args.length>0&&args[0].equals("write")){
            String token=c.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:17891/token")).build(),HttpResponse.BodyHandlers.ofString()).body();
            String uri="http://127.0.0.1:"+port+(kind.equals("carrito")?"/api/carrito/"+NativeAgent.OWNER+"/items":"/api/pedidos");
            String body=kind.equals("carrito")?"{\"productoId\":7,\"nombreProducto\":\"R2 concurrent fixture\",\"cantidad\":1,\"precioUnitario\":12.34}"
                :"{\"usuarioId\":\""+NativeAgent.OWNER+"\",\"emailUsuario\":\"race@example.invalid\",\"estado\":\"PENDIENTE\",\"total\":1,\"items\":[{\"productoId\":7,\"cantidad\":1,\"precioUnitario\":1}]}";
            int status=c.send(HttpRequest.newBuilder(URI.create(uri)).timeout(Duration.ofSeconds(3)).header("Authorization","Bearer "+token)
                .header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.discarding()).statusCode();
            if(status!=(kind.equals("carrito")?200:201))throw new IllegalStateException();
            System.out.println("R2_SYNTHETIC_WRITE_OK");return;
        }
        if(args.length>0&&args[0].equals("watch")){
            for(int i=0;i<80;i++){
                long start=System.nanoTime();
                int status=request(c,port,path,true);
                System.out.println(System.currentTimeMillis()+":"+status+":"+(System.nanoTime()-start)/1_000_000);Thread.sleep(250);
            }
        }else{
            if(request(c,port,path,false)!=401)throw new IllegalStateException();
            if(request(c,port,path,true)!=200)throw new IllegalStateException();
            System.out.println("ANONYMOUS_401_AUTHENTICATED_200");
        }
    }catch(Exception e){System.err.println("R2_PROBE_FAILED");System.exit(1);}}
    static int request(HttpClient c,String port,String path,boolean auth)throws Exception{
        var r=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(3));
        if(auth){String token=c.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:17891/token")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.ofString()).body();r.header("Authorization","Bearer "+token);}
        return c.send(r.build(),HttpResponse.BodyHandlers.discarding()).statusCode();
    }
}
