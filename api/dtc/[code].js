export default function handler(req, res) {

    const code = req.query.code?.toUpperCase();

    if (!code) {
        return res.status(400).json({
            error: "Falta el código DTC"
        });
    }

    const ejemplos = {

        P0420: {
            code: "P0420",
            title: "Eficiencia del sistema catalizador por debajo del umbral",
            make: req.query.make || "generic",
            severity: "MEDIA",

            problem:
                "La computadora detectó que la eficiencia del sistema catalizador está por debajo del límite esperado.",

            causes: [
                "Convertidor catalítico deteriorado.",
                "Sensor de oxígeno defectuoso.",
                "Fuga en el sistema de escape.",
                "Problemas de mezcla de combustible."
            ],

            symptoms: [
                "Check Engine encendido.",
                "Mayor consumo de combustible.",
                "Pérdida de rendimiento."
            ],

            diagnosis: [
                "Leer los códigos almacenados.",
                "Revisar fugas en el sistema de escape.",
                "Comprobar los sensores de oxígeno.",
                "Revisar datos en vivo del sistema OBD."
            ],

            repairs: [
                "Reparar fugas del escape.",
                "Reemplazar sensores defectuosos.",
                "Solucionar problemas de mezcla.",
                "Reemplazar el catalizador si las pruebas confirman que está dañado."
            ]
        }

    };


    const resultado = ejemplos[code];


    if (!resultado) {

        return res.status(404).json({
            error: "Código DTC no encontrado",
            code: code
        });

    }


    return res.status(200).json(resultado);

          }
