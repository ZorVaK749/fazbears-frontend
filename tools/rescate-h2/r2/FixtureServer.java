package r2lab;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.math.BigInteger;
import java.util.*;
public class FixtureServer {
    static final String ISSUER="http://127.0.0.1:17891/issuer";
    static final String AUD="22222222-2222-4222-8222-222222222222";
    static String b(byte[] bytes){return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
    static String unsigned(BigInteger n){byte[] a=n.toByteArray();return b(a[0]==0?Arrays.copyOfRange(a,1,a.length):a);}
    public static void main(String[] args)throws Exception{
        NativeAgent.guard();KeyPairGenerator g=KeyPairGenerator.getInstance("RSA");g.initialize(2048);KeyPair pair=g.generateKeyPair();
        RSAPublicKey publicKey=(RSAPublicKey)pair.getPublic();
        String jwks=NativeAgent.json(Map.of("keys",List.of(Map.of("kty","RSA","alg","RS256","use","sig","kid","r2-synthetic","n",unsigned(publicKey.getModulus()),"e",unsigned(publicKey.getPublicExponent())))));
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",17891),0);
        server.createContext("/", exchange->{try{
            String path=exchange.getRequestURI().getPath(),body;
            if(path.equals("/jwks"))body=jwks;
            else if(path.equals("/token")){
                long now=System.currentTimeMillis()/1000;
                String h=b(NativeAgent.json(Map.of("alg","RS256","kid","r2-synthetic")).getBytes(StandardCharsets.UTF_8));
                String p=b(NativeAgent.json(Map.of("iss",ISSUER,"aud",AUD,"sub","r2-pairwise","oid",NativeAgent.OWNER,"tid","11111111-1111-4111-8111-111111111111","scp","access_as_user","iat",now,"exp",now+120)).getBytes(StandardCharsets.UTF_8));
                Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign(pair.getPrivate());signature.update((h+"."+p).getBytes(StandardCharsets.UTF_8));body=h+"."+p+"."+b(signature.sign());
            } else body=NativeAgent.json(Map.of("issuer",ISSUER,"jwks_uri","http://127.0.0.1:17891/jwks","authorization_endpoint",ISSUER+"/authorize","token_endpoint",ISSUER+"/token","response_types_supported",List.of("code"),"subject_types_supported",List.of("public"),"id_token_signing_alg_values_supported",List.of("RS256")));
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type",path.equals("/token")?"text/plain":"application/json");exchange.sendResponseHeaders(200,bytes.length);try(var out=exchange.getResponseBody()){out.write(bytes);}
        }catch(Exception e){exchange.close();}});
        server.start();
    }
}
