import java.nio.file.*;
import java.io.*;
import java.sql.*;
import java.math.BigInteger;
import org.h2.tools.RunScript;
import org.h2.util.ScriptReader;

/** Harness deliberadamente limitado a archivos nuevos SYNTHETIC_ONLY; no JDBC remoto. */
class RestoreSynthetic {
    public static void main(String[] args) {
        try {
            if (args.length != 1) throw new IllegalArgumentException();
            Path root = Path.of(args[0]).toRealPath();
            if (!Files.readString(root.resolve(".synthetic-only")).equals("SYNTHETIC_ONLY\n")) throw new IllegalArgumentException();
            check(root.getFileName().toString().startsWith("synthetic-roundtrip-"));
            check(!root.toString().contains(";") && !root.toString().contains("\n"));
            roundtrip(root, "pedidos", "pedidos", "item_pedido", 1, 1, 2);
            roundtrip(root, "carrito", "carritos", "items_carrito", 2, 1, 5);
            System.out.println("H2 archivo: 2 BD sintéticas creadas, campos/FK/IDs/secuencias verificados y reapertura correcta.");
        } catch (Exception e) {
            // No stack ni SQL con valores: este patrón no debe filtrar datos si se reutiliza por error.
            System.err.println("FALLO_VALIDACION_SINTETICA"); System.exit(1);
        }
    }
    static void roundtrip(Path root, String kind, String parent, String child, int parents, int children, int queries) throws Exception {
        Path db = root.resolve(kind + "-stage");
        check(!Files.exists(Path.of(db + ".mv.db")));
        // Sin contraseña privada: SA vacío solo para estas BD nuevas de fixtures.
        String url = "jdbc:h2:file:" + db.toAbsolutePath().toString().replace('\\', '/');
        try (Connection c = DriverManager.getConnection(url, "sa", "")) {
            RunScript.execute(c, Files.newBufferedReader(root.resolve(kind + ".restore.sql")));
            verify(c, root.resolve(kind + ".verify.sql"), queries);
            check(count(c, parent) == parents && count(c, child) == children);
            // Comprobar también la secuencia de hijos, antes del ensayo de FK.
            c.setAutoCommit(false);
            String relation = kind.equals("pedidos") ? "pedido_id" : "carrito_id";
            try (Statement s = c.createStatement()) {
                s.executeUpdate("INSERT INTO " + child + " (" + relation
                    + ",producto_id,cantidad,precio_unitario) VALUES (9007199254740993,7,1,1)", Statement.RETURN_GENERATED_KEYS);
                try (ResultSet keys = s.getGeneratedKeys()) {
                    check(keys.next()); check(keys.getString(1).equals("9007199254740998"));
                }
            }
            c.rollback();
            // FK real: un hijo huérfano debe ser rechazado.
            String fk = kind.equals("pedidos") ? "pedido_id" : "carrito_id";
            boolean rejected = false;
            try (Statement s = c.createStatement()) {
                s.executeUpdate("INSERT INTO " + child + " (" + fk + ",producto_id,cantidad,precio_unitario) VALUES (999999,7,1,1)");
            } catch (SQLException expected) { rejected = "23506".equals(expected.getSQLState()); }
            check(rejected); c.rollback();
            // Probar secuencia de padres sin guardar fila adicional.
            c.setAutoCommit(false);
            BigInteger expected = new BigInteger(kind.equals("pedidos") ? "9007199254740994" : "9007199254740995");
            String sql = kind.equals("pedidos")
                ? "INSERT INTO pedidos (usuario_id,email_usuario,total,estado) VALUES ('synthetic-new','new@example.invalid',1,'PENDIENTE')"
                : "INSERT INTO carritos (usuario_id) VALUES ('synthetic-new')";
            try (Statement s = c.createStatement()) {
                s.executeUpdate(sql, Statement.RETURN_GENERATED_KEYS);
                try (ResultSet keys = s.getGeneratedKeys()) { check(keys.next()); check(new BigInteger(keys.getString(1)).equals(expected)); }
            }
            c.rollback();
        }
        // El proceso/JVM de test no es el servidor fuente. Cerrar/reabrir solo este archivo local.
        try (Connection c = DriverManager.getConnection(url + ";IFEXISTS=TRUE", "sa", "")) {
            check(count(c, parent) == parents && count(c, child) == children);
            verify(c, root.resolve(kind + ".verify.sql"), queries);
        }
    }
    static long count(Connection c, String table) throws Exception {
        try (var s = c.createStatement(); var r = s.executeQuery("SELECT COUNT(*) FROM " + table)) { r.next(); return r.getLong(1); }
    }
    static void verify(Connection c, Path path, int expectedQueries) throws Exception {
        int n = 0;
        try (ScriptReader reader = new ScriptReader(Files.newBufferedReader(path)); Statement s = c.createStatement()) {
            String query;
            while ((query = reader.readStatement()) != null) {
                if (query.isBlank()) continue;
                try (ResultSet r = s.executeQuery(query)) { check(r.next() && r.getLong(1) == 1); }
                n++;
            }
        }
        check(n == expectedQueries);
    }
    static void check(boolean condition) { if (!condition) throw new IllegalStateException(); }
}
